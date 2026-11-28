/* ================= INDIA STORE: PIECES HELD FOR WEBSITE ORDERS =================
 * Business rule (27 Nov, confirmed): finished pieces in the India store that open website orders (Ridhi and CPC) need cannot go
 * to FBA. Stock 10, need 4: 6 are free for FBA. Need 15: none are free, and new arrivals stay held too. An admin may release
 * pieces of one SKU, with a reason: FBA may then take that many more, never more than the stock, even when orders need more
 * than the store holds. An FBA save uses a release up only for pieces beyond what was free without it; it stays on record.
 * With switch storeAlloc also on (fg-store-alloc.js), FBA may take only the Air, Sea and AWD share of the stock instead.
 * Every way to FBA asks here: the entry form, scan out, Pack & verify, Scan to pack, an edit that sends more to FBA, and
 * deleting a "returned from FBA" row or undoing a part shipment (those pieces are with the FBA team again).
 *
 * The Shopify tab works out the need after it has read a store's orders (shopify-orders.js) and notes it, per store, at
 * pt_fgiSettings/_shopHold/{SP|CPC} = { at, by, skus: { SKU key: pieces }, orders: { SKU key: [{ no, pcs, on, of }] } }.
 * orders (28 Nov) names the orders behind each SKU's pieces, for the stock list: order number, pieces still needed, order date,
 * and the pieces asked ("of") when some were already issued. Never a customer's name, phone or address. A figure noted before
 * it has none. Releases sit beside it, under .../releases/<id>.
 * "_shopHold" can never be a SKU's own settings row: SKU rows are upper case.
 * On the test website live Shopify is off, so the tab counts the need from the shared copy of the orders instead, and "at" is
 * the time that copy last heard from Shopify.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — a release that cannot be saved, used up or given back (it is stock), and a figure that is missing,
 *   unreadable or over 6 hours old: FBA is refused. The sentence shown says what to do. On the test website only (asked
 *   28 Nov: its shared copy of the orders is not kept up to date) an old figure is accepted, with a warning on the screens.
 *   quiet, with a console line — the switch (storage blocked: off), noting the figure after the Shopify tab reads orders, and
 *   reading it when a packing screen opens or the store list refreshes (every save reads it again, loudly).
 *
 * BEHIND SWITCH shopHold. On by itself on the test website only (asked 27 Nov; saving is off there), OFF everywhere else,
 * branch test links too (a device with it on there writes live data). localStorage shopHold = '1' turns it on for one
 * computer, '0' off. The way back is that same '0'. */
const SHP_HOLD_PATH = 'pt_fgiSettings/_shopHold';
const SHP_HOLD_STORES = ['SP', 'CPC'];
const SHP_HOLD_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // older than this, FBA is refused
const SHP_HOLD_CLOCK_SLACK_MS = 10 * 60 * 1000;   // noted further ahead than this: that PC's clock is wrong, the figure is not trusted
const SHP_HOLD_REWRITE_MS = 60 * 60 * 1000;       // an unchanged figure is noted again after this, so it does not look old
const SHP_HOLD_TRIES = 3;

/** Is this the test website? */
const shpOnTestSite = () => typeof window !== 'undefined' && !!window.__TEST_ERP;

/** Is the hold on for this PC? localStorage wins ('1' on, '0' off), else the default:
 *  on for the test website, off elsewhere. */
function shpHoldOn() {
  try { const v = localStorage.getItem('shopHold'); if (v === '1') return true; if (v === '0') return false; }
  catch (e) { console.warn('India store hold: this browser blocks saved settings, so the switch uses its default.'); }
  return shpOnTestSite();
}

/** Is stock also shared between Custom, FBA and Excess (fg-store-alloc.js)? */
const shpAllocOn = () => typeof fgaOn === 'function' && fgaOn();

/* ---- the need of one store ---- */
/** The name a SKU is held under (the database refuses some characters). */
const shpHoldKey = sku => lstKey(sku);

/** The orders an issue names: the SHP board and "complete from stock" in the Order Console name one on the row itself. */
function shpHoldPartsOf(r) {
  const named = r.shpOrderNo || r.stockForOrder;
  return named ? [{ orderNo: named, qty: r.qty }] : fgiOutParts(r);
}

/** Pieces already issued from the store to each order, by 'ORDER|SKU key'. A reversed issue does not count. */
function shpHoldIssued(ledgerRows) {
  const out = new Map();
  (ledgerRows || []).forEach(r => {
    if (!r || r.txnType !== 'ISSUE' || r.reversed === true) return;
    shpHoldPartsOf(r).forEach(p => {
      const k = obUC(p.orderNo) + '|' + shpHoldKey(r.sku);
      out.set(k, (out.get(k) || 0) + fgiNum(p.qty));
    });
  });
  return out;
}

/** What each order still needs of each SKU: [{ orderNo, ref, on, key, asked, pieces }]. claims: [{ orderNo, sku, sets, perSet,
 *  ref?, on? }] — what the open orders ask for, in sets of perSet pieces; orderNo is the production number ('SHP-4876'), ref the
 *  Shopify order name (it tells apart orders with no production number), on the order date. What was already issued to that
 *  order is no longer needed from the shelf, so it is taken off, once. */
function shpHoldLeft(claims, ledgerRows) {
  const need = new Map();
  (claims || []).forEach(c => {
    const orderNo = obUC(c.orderNo), ref = c.ref || '', key = shpHoldKey(c.sku), id = (orderNo || ref) + '|' + key;
    const had = need.get(id) || { orderNo, ref, on: c.on || '', key, asked: 0 };
    need.set(id, Object.assign({}, had, { asked: had.asked + Math.round(fgiNum(c.sets) * fgiNum(c.perSet)) }));
  });
  const issued = shpHoldIssued(ledgerRows);
  return [...need.values()]
    .map(n => Object.assign({}, n, { pieces: n.asked - Math.round(issued.get(n.orderNo + '|' + n.key) || 0) }))
    .filter(n => n.pieces > 0);
}
/** PIECES HELD, per SKU key, for one store. */
function shpHoldBuild(claims, ledgerRows) {
  const skus = {};
  shpHoldLeft(claims, ledgerRows).forEach(n => { skus[n.key] = (skus[n.key] || 0) + n.pieces; });
  return skus;
}
/** Orders { no, on } oldest first; one with no date comes last. */
const shpHoldOldestFirst = (a, b) => String(a.on || '9999').localeCompare(String(b.on || '9999'))
  || String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
/** One order behind a SKU's held pieces, as noted. The database keeps no empty values, so none are written. */
const shpHoldEntry = n => Object.assign({ no: n.orderNo || n.ref, pcs: n.pieces }, n.on ? { on: n.on } : {},
  n.asked > n.pieces ? { of: n.asked } : {});
/** What one store's figure says: { skus: the pieces held per SKU key, orders: the orders behind them, oldest first }. */
function shpHoldNeed(claims, ledgerRows) {
  const orders = {};
  shpHoldLeft(claims, ledgerRows).forEach(n => { (orders[n.key] = orders[n.key] || []).push(shpHoldEntry(n)); });
  Object.values(orders).forEach(list => list.sort(shpHoldOldestFirst));
  return { skus: shpHoldBuild(claims, ledgerRows), orders };
}

/* ---- noting it ---- */
/** Was this noted by a PC whose clock runs ahead? */
const shpHoldAhead = (at, nowMs) => at > nowMs + SHP_HOLD_CLOCK_SLACK_MS;

/** Do two figures say the same: the pieces per SKU, and the orders behind them? */
const shpHoldSaysSame = (a, b) => ptSame(a.skus || {}, b.skus || {}) && ptSame(a.orders || {}, b.orders || {});

/** A newer read replaces the noted figure when it says something else, or the noted one is getting old. One noted by a
 *  clock that runs ahead is always replaced, or it would block every later read. */
function shpHoldShouldWrite(noted, figure, nowMs = Date.now()) {
  if (!noted || !noted.at || shpHoldAhead(noted.at, nowMs)) return true;
  /* The test website notes the shared copy's own sync time: every newer copy is noted, and so is the same copy when the need
   * has changed since (pieces issued to an order, an order marked done). */
  if (shpOnTestSite()) return figure.at > noted.at || (figure.at === noted.at && !shpHoldSaysSame(noted, figure));
  if (!(figure.at > noted.at)) return false;
  return figure.at - noted.at > SHP_HOLD_REWRITE_MS || !shpHoldSaysSame(noted, figure);
}

/** Note one store's figure { at, by, skus, orders }, checked and written in one step. Never throws: '' when noted (or nothing needed
 *  noting), else why not, also said in the console. */
async function shpHoldPublish(store, figure) {
  const path = SHP_HOLD_PATH + '/' + store;
  try {
    for (let i = 0; i < SHP_HOLD_TRIES; i++) {
      const noted = await ptGetFresh(path);
      if (!shpHoldShouldWrite(noted, figure)) return '';
      const answer = await ptCas(path, noted, figure, { quiet: true });
      if (!answer) return '';
      if (answer === 'refused') return shpHoldUnnoted(store, 'this account may not note it');
    }
    return shpHoldUnnoted(store, 'it kept changing — press Fetch orders again');
  } catch (e) { return shpHoldUnnoted(store, e.message || String(e)); }
}
function shpHoldUnnoted(store, why) {
  console.warn('India store hold: the ' + store + ' figure was not noted: ' + why);
  return why;
}

/* ---- reading it ---- */
/** The whole noted record (both stores and the releases) as Finished Goods last read it. */
const fgiHoldNode = () => (FGI.set || {})._shopHold || {};

/** { state: 'ok' | 'stale' | 'missing', at, ageMs } — judged on the OLDER of the two stores; both are needed. */
function fgiHoldState(hold = fgiHoldNode(), nowMs = Date.now()) {
  const times = SHP_HOLD_STORES.map(s => Number(((hold || {})[s] || {}).at) || 0);
  if (times.some(t => !t)) return { state: 'missing', at: 0, ageMs: 0 };
  const at = Math.min(...times), ageMs = Math.max(0, nowMs - at);
  const stale = (ageMs > SHP_HOLD_MAX_AGE_MS && !shpOnTestSite()) || times.some(t => shpHoldAhead(t, nowMs));
  return { state: stale ? 'stale' : 'ok', at, ageMs };
}

/** Pieces of a SKU the two stores' orders need. */
const fgiHeld = (sku, hold = fgiHoldNode()) => SHP_HOLD_STORES.reduce((n, s) =>
  n + (Number((((hold || {})[s] || {}).skus || {})[shpHoldKey(sku)]) || 0), 0);

/** A SKU's releases that still have pieces to use, oldest first, as [id, release]. */
const fgiReleasesOpen = (sku, releases) => Object.entries(releases || {})
  .filter(([, r]) => r && shpHoldKey(r.sku) === shpHoldKey(sku) && Number(r.left) > 0)
  .sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)) || a[0].localeCompare(b[0]));
const fgiReleased = (sku, hold = fgiHoldNode()) => fgiReleasesOpen(sku, (hold || {}).releases)
  .reduce((n, [, r]) => n + Number(r.left), 0);

/** Pieces of a SKU free to go to FBA. Says nothing about the figure's age: ask fgiHoldState first. */
function fgiFbaFree(sku, current = fgiOf(sku).current, hold = fgiHoldNode(), book) {
  const have = Math.max(0, current);
  if (shpAllocOn()) return Math.min(have, fgaFbaShare(sku, have, hold, book) + fgiReleased(sku, hold));
  return Math.min(have, Math.max(0, have - fgiHeld(sku, hold)) + fgiReleased(sku, hold));
}

/** The warning the test website shows while it works from a figure the live ERP would refuse, or ''. */
function fgiHoldOldWarning(hold = fgiHoldNode(), nowMs = Date.now()) {
  const { state, ageMs } = fgiHoldState(hold, nowMs);
  return shpOnTestSite() && state === 'ok' && ageMs > SHP_HOLD_MAX_AGE_MS
    ? 'TEST ONLY: website orders are counted from a copy over 6 hours old, so newer orders are missing.' : '';
}

/* ---- refusing ---- */
/** Why the noted figure cannot be trusted for an FBA save, or ''. A release does not help while it is old. */
function fgiHoldAgeWhy(hold = fgiHoldNode()) {
  const { state } = fgiHoldState(hold);
  if (state === 'ok') return '';
  if (shpOnTestSite()) return shpHoldTestAgeWhy(state);
  return state === 'missing'
    ? 'The pieces held for website orders are not known yet — open the Shopify Orders tab and press Fetch orders, then try again.'
    : 'The pieces held for website orders are over 6 hours old (or were noted by a PC whose clock is ahead) — open the Shopify Orders tab and press Fetch orders, then try again. A release does not help while the figure is old.';
}
/** The same on the test website, where the figure comes from the shared copy and can be noted only in UAT mode. */
const shpHoldTestAgeWhy = state => (state === 'missing' ? 'The pieces held for website orders are not known yet'
  : 'The pieces held for website orders are over 6 hours old (or carry a time ahead of this PC\'s clock)')
  + ' — on the test website, turn UAT mode on, open the Shopify Orders tab and press Fetch orders. They are counted from the'
  + ' shared copy of the orders: the line there says how old it is, or why it could not be noted.'
  + (state === 'missing' ? '' : ' A release does not help while the figure is old.');
/** Why the noted figures cannot be trusted just now, or '': the website hold, and the FBA need when stock is shared. */
const fgiFbaAgeWhy = hold => fgiHoldAgeWhy(hold) || (shpAllocOn() ? fgaNeedWhy() : '');
const fgiShortWhy = (s, hold) => shpAllocOn() ? fgaShortWhy(s) : `${s.sku} has ${nf(s.free)} piece(s) free for FBA, not ${nf(s.qty)} (${nf(fgiHeld(s.sku, hold))} held for website orders).`
  + ' Send fewer, or ask an admin to release held pieces on Finished Goods.';
/** Why these pieces cannot go to FBA, or ''. wants: [{ sku, qty, current }]. */
function fgiHoldRefusal(wants, hold = fgiHoldNode()) {
  return fgiFbaAgeWhy(hold) || fgiReleasePlan(hold, wants, {}).short.map(s => fgiShortWhy(s, hold)).join(' ');
}

/* ---- the packing screens ---- */
/** The order lines of a packing list, each line's store pieces cut to what its SKU has free for FBA. New lines are returned. */
function fgiHoldCap(lines) {
  const known = !fgiFbaAgeWhy(), stock = fgiStock(), left = new Map(), book = shpAllocOn() ? fgaBook() : undefined;
  return lines.map(l => {
    const sku = obUC(l.sku);
    if (!left.has(sku)) left.set(sku, known ? fgiFbaFree(sku, (stock.get(sku) || {}).current || 0, fgiHoldNode(), book) : 0);
    const store = Math.min(l.store, left.get(sku));
    left.set(sku, left.get(sku) - Math.max(0, Math.min(l.qty, store)));
    return Object.assign({}, l, { store });
  });
}
/** What to tell the packer when a scan finds no stock because of the hold; '' when the hold is not the reason.
 *  packed: { orderNo: pieces } already in this list for the SKU. */
function fgiHoldScanWhy(sku, packed) {
  const age = fgiFbaAgeWhy();
  if (age) return age;
  const current = fgiOf(sku).current, free = fgiFbaFree(sku, current);
  const inList = Object.values(packed || {}).reduce((n, q) => n + fgiNum(q), 0);
  return free < current && inList >= free ? fgiShortWhy({ sku, free, qty: inList + 1 }, fgiHoldNode()) : '';
}

/* ---- reading it again ---- */
const fgiHoldKeep = node => { FGI.set = Object.assign({}, FGI.set, { _shopHold: node }); };
const fgiHoldUnread = e => 'Nothing was saved — the pieces held for website orders could not be checked (' + (e.message || e) + '). Check the connection and save again.';
/** Read the noted figure and the releases (and the other FBA share figures, when stock is shared) as they are now.
 *  '' when read, else the sentence to show. */
async function fgiHoldReread() {
  try {
    fgiHoldKeep((await ptGetFresh(SHP_HOLD_PATH)) || {});
    if (shpAllocOn()) await fgaFiguresReread();
    return '';
  }
  catch (e) {
    console.warn('India store hold: the pieces held for website orders could not be read:', e.message || e);
    return fgiHoldUnread(e);
  }
}

/* ---- releases ---- */
/** AN ADMIN LETS N HELD PIECES GO. v: { id, sku, pieces, reason } — the id is made once per form (fgiNewId('REL')), so a
 *  second press saves nothing new. '' when saved, else the sentence to show. */
async function fgiReleaseCreate(v) {
  if (!(ME && ME.admin)) return 'Only an admin can release pieces held for website orders.';
  const sku = obUC(v.sku), pieces = Number(v.pieces), reason = String(v.reason || '').trim();
  if (!sku) return 'Pick the SKU to release.';
  if (!Number.isInteger(pieces) || pieces < 1) return 'Type how many pieces of ' + sku + ' to release, as a whole number.';
  if (!reason) return 'Say why these pieces of ' + sku + ' can go to FBA.';
  const rec = { sku, pcs: pieces, left: pieces, reason, by: ME.email, at: new Date().toISOString() };
  try {
    const answer = await ptCas(SHP_HOLD_PATH + '/releases/' + v.id, null, rec);
    if (answer) return 'This release of ' + sku + ' is already saved — press Refresh to see it.';
  } catch (e) { return 'The release of ' + sku + ' was not saved: ' + (e.message || e) + ' — try again.'; }
  return '';
}

/** WHAT AN FBA SAVE USES UP. wants: [{ sku, qty, current }] (current = pieces in stock before the save). Only the pieces beyond
 *  what was free without a release are taken from releases, oldest first. Returns { next, used: { id: pieces }, short:
 *  [{ sku, qty, free }] }; with anything short, next is the releases unchanged. The releases handed in are not changed.
 *  A want's `without` names the movement being changed, left out when the stock is shared. */
function fgiReleasePlan(hold, wants, stamp) {
  const releases = (hold || {}).releases || {}, next = Object.assign({}, releases), used = {}, short = [];
  const bySku = new Map();
  const book = shpAllocOn() ? fgaBook(new Set((wants || []).map(w => w.without).filter(Boolean))) : undefined;
  (wants || []).forEach(w => {
    const key = shpHoldKey(w.sku), had = bySku.get(key);
    bySku.set(key, { sku: w.sku, current: w.current, qty: fgiNum(w.qty) + (had ? had.qty : 0) });
  });
  bySku.forEach(w => {
    const free = fgiFbaFree(w.sku, w.current, hold, book);
    if (w.qty > free) { short.push({ sku: w.sku, qty: w.qty, free }); return; }
    let owed = w.qty - Math.max(0, w.current - fgiHeld(w.sku, hold));   // only the pieces beyond what was free anyway
    if (book) owed = w.qty - fgaFbaShare(w.sku, w.current, hold, book);
    fgiReleasesOpen(w.sku, releases).forEach(([id, r]) => {
      const take = Math.min(owed, Number(r.left));
      if (take <= 0) return;
      owed -= take; used[id] = take;
      next[id] = Object.assign({}, r, { left: Number(r.left) - take,
        uses: (r.uses || []).concat({ pcs: take, by: stamp.by, at: stamp.at }) });
    });
  });
  return short.length ? { next: releases, used: {}, short } : { next, used, short };
}

/** USE THE RELEASES UP, ONCE, just before an FBA save: the noted figure is read again and the releases are written only if
 *  nobody changed them meanwhile. { err: '', used } when the save may go ahead; else err is the sentence to show. */
async function fgiReleaseSpend(wants) {
  try {
    for (let i = 0; i < SHP_HOLD_TRIES; i++) {
      const hold = (await ptGetFresh(SHP_HOLD_PATH)) || {};
      fgiHoldKeep(hold);
      if (shpAllocOn()) await fgaFiguresReread();
      const why = fgiHoldRefusal(wants, hold);
      if (why) return { err: 'Nothing was saved — ' + why, used: {} };
      const plan = fgiReleasePlan(hold, wants, { by: ME.email, at: new Date().toISOString() });
      if (!Object.keys(plan.used).length) return { err: '', used: {} };
      if (!(await ptCas(SHP_HOLD_PATH + '/releases', hold.releases, plan.next))) {
        fgiHoldKeep(Object.assign({}, hold, { releases: plan.next }));
        return { err: '', used: plan.used };
      }
    }
    return { err: 'Nothing was saved — the releases kept changing. Press Save again.', used: {} };
  } catch (e) { return { err: fgiHoldUnread(e), used: {} }; }
}

/** The releases with the pieces of a failed save put back, each with its history line. The releases handed in are not changed. */
function fgiReleaseReturned(releases, used, stamp) {
  const next = Object.assign({}, releases);
  Object.entries(used).forEach(([id, pcs]) => {
    const r = next[id];
    if (r) next[id] = Object.assign({}, r, { left: Number(r.left) + pcs, uses: (r.uses || []).concat({ pcs: -pcs, by: stamp.by, at: stamp.at }) });
  });
  return next;
}
/** Give the pieces a failed save used back to their releases. Answers with what to add to the message on screen. */
async function fgiReleaseGiveBack(used) {
  const pieces = Object.values(used).reduce((n, q) => n + q, 0);
  if (!pieces) return '';
  const path = SHP_HOLD_PATH + '/releases';
  try {
    for (let i = 0; i < SHP_HOLD_TRIES; i++) {
      const releases = await ptGetFresh(path);
      const next = fgiReleaseReturned(releases, used, { by: ME.email, at: new Date().toISOString() });
      if (!(await ptCas(path, releases, next))) return ` The ${nf(pieces)} released piece(s) it had used were given back.`;
    }
  } catch (e) { console.warn('India store hold: released pieces were not given back:', e.message || e); }
  return ` The ${nf(pieces)} released piece(s) it had used were NOT given back — ask an admin to release them again.`;
}

/** SAVE PIECES TO FBA: the releases are used up, then write() saves the ledger; a failed write gives them back. Call it only
 *  after every other check has passed. No wants: nothing new goes to FBA, so it only writes. '' when saved, else the
 *  sentence to show. */
async function fgiFbaWrite(wants, write) {
  if (!wants.length) { await write(); return ''; }
  const spent = await fgiReleaseSpend(wants);
  if (spent.err) return spent.err;
  try { await write(); }
  catch (e) { return 'Not saved: ' + (e.message || e) + '.' + await fgiReleaseGiveBack(spent.used); }
  return '';
}

/** What an edit of a movement newly sends to FBA, as fgiFbaWrite wants it: [] when it sends nothing more. */
function fgiFbaEditWants(was, now) {
  if (now.txnType !== 'FBA') return [];
  const sku = obUC(now.sku), sameSku = sku === obUC(was.sku);
  if (sameSku && was.txnType === 'FBA') {
    const more = fgiNum(now.qty) - fgiNum(was.qty);
    return more > 0 ? [{ sku, qty: more, current: fgiOf(sku).current }] : [];
  }
  /* Newly FBA: judged as a fresh dispatch, with this movement's old effect on the SKU taken back first. */
  return [{ sku, qty: fgiNum(now.qty), current: fgiOf(sku).current - (sameSku ? fgiEffect(was) : 0), without: was._id || was.id }];
}

/** What deleting movements sends back to FBA, as fgiFbaWrite wants it: the "returned from FBA" rows that go while their
 *  dispatch stays, so their pieces are with the FBA team again. */
function fgiFbaReturnWants(deleted) {
  const gone = new Set(deleted.map(fgiRowId));
  return deleted.filter(r => r.txnType === 'FBA_RETURN' && !gone.has(r.linkedFbaId))
    .map(r => ({ sku: obUC(r.sku), qty: fgiNum(r.qty), current: fgiOf(r.sku).current }));
}

/* ---- on the Finished Goods stock list ---- */
/** The "held" figure of a stock row. */
function fgiHeldCell(sku) {
  const age = fgiHoldAgeWhy();
  if (age) return `<span class="muted" title="${esc(age)}">not known</span>`;
  const held = fgiHeld(sku), released = fgiReleased(sku);
  return (held ? nf(held) : '<span class="muted">—</span>')
    + (released ? `<div class="muted" style="font-size:10.5px">${nf(released)} released</div>` : '');
}
/** shares: the row's stock shares, when stock is shared. */
const fgiMayRelease = (sku, shares) => !!(ME && ME.admin) && (shpAllocOn() ? fgaKeptBack(shares) : fgiHeld(sku) > 0);

/** The admin's release form. The id is made once per form, so a second press saves nothing new. */
function fgiReleaseOpen(sku) {
  const s = obUC(sku), id = fgiNewId('REL');
  ptOpenDialog({
    title: 'Release held pieces',
    subtitle: shpAllocOn() ? `${s} · ${nf(fgiFbaFree(s))} free for FBA · ${nf(fgiOf(s).current)} in stock`
      : `${s} · ${nf(fgiHeld(s))} held for website orders · ${nf(fgiOf(s).current)} in stock`,
    note: 'FBA may then take this many more pieces of the SKU, never more than the stock.',
    fields: [{ key: 'sku', label: 'SKU', value: s, readonly: true }, { key: 'pieces', label: 'Pieces', type: 'number', min: 1, step: 1, value: '' },
      { key: 'reason', label: 'Reason', value: '', span: true }],
    onSave: async v => {
      const why = await fgiReleaseCreate({ id, sku: s, pieces: v.pieces, reason: v.reason });
      if (why) return why;
      await fgiHoldReread();   // unread: the list keeps the last figure, and the console says why
      renderFgi();
      $('fgMsg').className = 'muted';
      $('fgMsg').textContent = `${nf(Number(v.pieces))} ${shpAllocOn() ? '' : 'held '}piece(s) of ${s} released for FBA.`;
      return '';
    },
    saveLabel: 'Release them',
  });
}
