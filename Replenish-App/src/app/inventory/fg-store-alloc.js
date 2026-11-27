/* ================= INDIA STORE: WHO EACH PIECE IS FOR =================
 * Business rule (27 Nov, agreed): each SKU's stock in the India store is shared in this order — Photoshoot (no figures yet,
 * always 0), Custom (open orders other than Amazon, and what website orders need), FBA Air, FBA Sea, FBA AWD; the rest is
 * Excess. New receipts follow the same order by themselves.
 *   Custom  = order-book lines still open (not a Shopify order's own line, not closed, not handed over), less pieces already
 *             issued to each, plus the Shopify website hold (fg-shop-hold.js).
 *   FBA     = what Replenishment asks to send (SP and CPC together, in pieces), less dispatches already on the way: every
 *             one not yet marked shipped, and any shipped after the Amazon figures were read. Air is reduced first.
 * What may leave: FBA only the Air + Sea + AWD pieces the stock covers, plus an admin's release; an issue for an order up to
 * that order's pending pieces within Custom, plus Excess; any other issue Excess only.
 *
 * Replenishment's full figures are read only by planners and admins, so their ERP notes the need for the store at
 * pt_fgiSettings/_fbaNeed/{SP|CPC} = { snapAt, at, by, skus: { SKU key: [air, sea, awd] in Amazon packs } } whenever it
 * reads them. Figures over 24 hours old: their ERP asks for a fresh round by itself, at most once an hour.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — figures missing, unreadable or old: FBA and issues not for an order are refused, with what to do.
 *   An issue for an order may still take that order's Custom pieces. A ledger or order book that cannot be read just before
 *   a save: nothing is saved.
 *   quiet, with a console line — the switch (storage blocked: off), noting the need, and asking for fresh Amazon figures.
 *
 * BEHIND SWITCH storeAlloc, which needs shopHold on. On by itself on the test website only, OFF everywhere else.
 * localStorage storeAlloc = '1' turns it on for one computer, '0' off. The way back is that same '0'. */
const FGA_PATH = 'pt_fgiSettings/_fbaNeed';
const FGA_STORE_OF = { 'Ridhi FBA': 'SP', 'CPC FBA': 'CPC' };
const FGA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FGA_ASK_EVERY_MS = 60 * 60 * 1000;
const FGA_ASKED_KEY = 'fbaNeedAskedAt';
const FGA_TRIES = 3;
/** The share columns of the stock list, in the order stock is given out. */
const FGA_SHARES = [['photo', 'Photoshoot'], ['custom', 'Custom'], ['air', 'FBA Air'], ['sea', 'FBA Sea'], ['awd', 'FBA AWD'], ['excess', 'Excess']];
let FGA_ASKED_AT = 0;   // this tab's last ask, for a browser that blocks saved settings

function fgaOn() {
  if (!shpHoldOn()) return false;
  try { const v = localStorage.getItem('storeAlloc'); if (v === '1') return true; if (v === '0') return false; }
  catch (e) { console.warn('India store shares: this browser blocks saved settings, so the switch uses its default.'); }
  return typeof window !== 'undefined' && !!window.__TEST_ERP;
}

/* ---- the noted FBA need ---- */
const fgaNeedNode = () => (FGI.set || {})._fbaNeed || {};
const fgaNeedKeep = node => { FGI.set = Object.assign({}, FGI.set, { _fbaNeed: node }); };

/** { state: 'ok' | 'stale' | 'missing', snapAt } — judged on the OLDER of the two stores; both are needed. */
function fgaNeedState(need = fgaNeedNode(), nowMs = Date.now()) {
  const times = SHP_HOLD_STORES.map(s => Number(((need || {})[s] || {}).snapAt) || 0);
  if (times.some(t => !t)) return { state: 'missing', snapAt: 0 };
  const snapAt = Math.min(...times);
  return { state: nowMs - snapAt > FGA_MAX_AGE_MS ? 'stale' : 'ok', snapAt };
}

/** Why the noted FBA need cannot be trusted, or ''. */
function fgaNeedWhy(need = fgaNeedNode()) {
  const { state } = fgaNeedState(need);
  if (state === 'ok') return '';
  return (state === 'missing' ? 'The FBA need from Replenishment is not noted yet' : 'The FBA need from Replenishment is over 24 hours old')
    + ' — ask a planner or an admin to open Replenishment (fresh Amazon figures take a few minutes), then press Refresh and try again.'
    + ' A release does not help until then.';
}

/** Read the noted need as it is now. Throws when it cannot be read. An old figure also asks for a fresh round; a missing one
 *  does not, as fresh Amazon figures would not note it. */
async function fgaNeedReread() {
  const need = (await ptGetFresh(FGA_PATH)) || {};
  fgaNeedKeep(need);
  if (fgaNeedState(need).state === 'stale') fgaAskFresh();
}

/* ---- noting it (planners and admins) ---- */
/** One store's need from its Replenishment rows, in Amazon packs: stopped SKUs ask nothing, hidden ones are left out. */
function fgaNeedSkus(rows) {
  const skus = {};
  (rows || []).filter(r => r && r.sku && !isHiddenSku(r.sku)).forEach(r => {
    const q = replReq(applyStatus(Object.assign({}, r)));
    const lanes = [q.air, q.sea, q.awd].map(n => Math.max(0, Math.round(Number(n) || 0)));
    if (!lanes.some(n => n > 0)) return;
    const key = shpHoldKey(r.sku), had = skus[key] || [0, 0, 0];
    skus[key] = lanes.map((n, i) => n + had[i]);
  });
  return skus;
}

/** Newer Amazon figures replace the noted ones; the same figures only when the need changed (a status set by hand). */
function fgaShouldNote(noted, figure) {
  if (!noted || !noted.snapAt || figure.snapAt > noted.snapAt) return true;
  return figure.snapAt === noted.snapAt && !ptSame(noted.skus || {}, figure.skus);
}

/** Note one store's figure, checked and written in one step. Never throws; a failure is said in the console. */
async function fgaPublish(store, figure) {
  const path = FGA_PATH + '/' + store;
  const unnoted = why => console.warn('India store shares: the ' + store + ' FBA need was not noted: ' + why);
  try {
    for (let i = 0; i < FGA_TRIES; i++) {
      const noted = await ptGetFresh(path);
      if (!fgaShouldNote(noted, figure)) return;
      const answer = await ptCas(path, noted, figure, { quiet: true });
      if (!answer) return;
      if (answer === 'refused') return unnoted('this account may not note it');
    }
    unnoted('it kept changing');
  } catch (e) { unnoted(e.message || String(e)); }
}

/** Called when the full Replenishment figures are in hand, and when a status is set by hand. Never throws. */
async function fgaNeedNote() {
  if (!fgaOn() || !replFull()) return;
  try {
    await loadProd();                                    // statuses set by hand decide which SKUs are stopped
    if (!replMaster()) await replMasterLoad();           // so does the Master Database's listing status
    if (!replMaster()) return console.warn('India store shares: the FBA need was not noted — the Master Database is still being read.');
    replMasterSync();
    for (const store of SHP_HOLD_STORES) {
      const snap = REPL[store];
      if (!snap || snap.mode !== 'full' || !snap.at) continue;
      const snapAt = snap.at.getTime();
      await fgaPublish(store, { snapAt, at: Date.now(), by: ME.email, skus: fgaNeedSkus(snap.rows) });
      if (Date.now() - snapAt > FGA_MAX_AGE_MS) await fgaAskFresh();
    }
  } catch (e) { console.warn('India store shares: the FBA need was not noted:', e.message || e); }
}

function fgaAskedAt() {
  try { return Math.max(FGA_ASKED_AT, Number(localStorage.getItem(FGA_ASKED_KEY)) || 0); }
  catch (e) { console.warn('India store shares: this browser blocks saved settings, so only this tab remembers when it asked.'); return FGA_ASKED_AT; }
}
/** Ask for fresh Amazon figures (the Replenishment Refresh button's own call), at most once an hour. Planners and admins
 *  only; not from the test website, which must not set the live backend working by itself. Never throws. */
async function fgaAskFresh() {
  if (!replFull() || Date.now() - fgaAskedAt() < FGA_ASK_EVERY_MS) return;
  if (typeof window !== 'undefined' && window.__TEST_ERP) return console.warn('India store shares: the FBA need is old; the test website does not ask for fresh Amazon figures by itself.');
  FGA_ASKED_AT = Date.now();
  try { localStorage.setItem(FGA_ASKED_KEY, String(FGA_ASKED_AT)); } catch (e) { console.warn('India store shares: the time of this ask is remembered by this tab only.'); }
  try { await prGet({ inv: 'run', job: 'refresh', brand: 'all', by: ME.email || '' }); }
  catch (e) { console.warn('India store shares: could not ask for fresh Amazon figures:', e.message || e); }
}
/** At sign-in, for planners and admins: an old need asks for a fresh round. Never throws. */
async function fgaSignInCheck() {
  if (!fgaOn() || !replFull()) return;
  try { await fgaNeedReread(); }
  catch (e) { console.warn('India store shares: the noted FBA need could not be read:', e.message || e); }
}

/* ---- just before a stock-out save ---- */
/** The ledger, the order book, the hand-overs, the website hold and the FBA need, read again. '' = go ahead, else the
 *  sentence to show: this is stock, so nothing is saved on figures that could not be read. */
async function fgaReread() {
  try {
    const [ledger] = await Promise.all([ptGet('pt_fgiLedger'), ptReadReg('ob'), ptReadReg('shopProd')]);
    FGI.rows = ptList(ledger);
  } catch (e) {
    console.warn('India store shares: the store or the order book could not be read just before a save:', e.message || e);
    return 'Nothing was saved — the India store and the order book could not be read just now (' + (e.message || e) + '). Check the connection and save again.';
  }
  return fgiHoldReread();
}

/* ---- sharing the stock ---- */
const fgaOpenLines = lines => lines.filter(l => ordSrcOf(l.orderNo) !== 'AMZ' && !l.shopDoneAt && !l.handedAt);
const fgaClaim = l => ({ orderNo: l.orderNo, sku: l.sku, sets: l.qty, perSet: 1 });

/** Dispatches still on the way to FBA, in pieces: Map of SKU key → { SP, CPC, '' (account unknown) }. Each dispatch counts
 *  once: not yet marked shipped, or shipped after its store's Amazon figures were read (no shipping time: made after). */
function fgaOnTheWay(rows, need) {
  const snapAtOf = store => Number(((need || {})[store] || {}).snapAt) || Infinity;
  const oldest = Math.min(...SHP_HOLD_STORES.map(snapAtOf));
  const out = new Map();
  (rows || []).forEach(r => {
    if (!r || r.txnType !== 'FBA') return;
    const { st, open } = fbaState(r);
    if (st === 'sheet' || open <= 0) return;
    const store = FGA_STORE_OF[r.issuedFor] || '';
    if (st === 'shipped' && !(Date.parse(r.fbaShippedAt || r.createdAt) > (store ? snapAtOf(store) : oldest))) return;
    const key = shpHoldKey(r.sku), had = out.get(key) || {};
    out.set(key, Object.assign({}, had, { [store]: (had[store] || 0) + open }));
  });
  return out;
}

/** What the shares are worked out from, built once for a whole list or save. without: ids of movements to leave out (a row
 *  being changed is judged as if it had not been made). */
function fgaBook(without, need = fgaNeedNode()) {
  const rows = without && without.size ? (FGI.rows || []).filter(r => !without.has(r._id || r.id)) : (FGI.rows || []);
  const open = fgaOpenLines(ordLines());
  return { rows, open, need, onTheWay: fgaOnTheWay(rows, need),
    ordered: shpHoldBuild(open.filter(l => !l.shopOrderId).map(fgaClaim), rows) };
}

/** The pieces FBA still asks for, per lane, for these stores, less what is on the way (Air first, then Sea, then AWD). */
function fgaLanes(sku, book, stores) {
  const key = shpHoldKey(sku), pack = fgiPackOf(sku), way = book.onTheWay.get(key) || {};
  const asked = [0, 1, 2].map(i => stores.reduce((n, s) => n + (Number(((((book.need || {})[s] || {}).skus || {})[key] || [])[i]) || 0) * pack, 0));
  let coming = stores.concat('').reduce((n, s) => n + (way[s] || 0), 0);
  const [air, sea, awd] = asked.map(n => { const met = Math.min(n, coming); coming -= met; return n - met; });
  return { air, sea, awd };
}

/** A SKU's stock shared out: { photo, custom, air, sea, awd, excess }, adding up to the stock (never below 0).
 *  stores narrows the FBA lanes for viewing; a save is always judged on both. */
function fgaShares(sku, current, hold, book, stores = SHP_HOLD_STORES) {
  let left = Math.max(0, current);
  const take = wanted => { const n = Math.min(left, Math.max(0, wanted)); left -= n; return n; };
  const lanes = fgaLanes(sku, book, stores);
  const photo = take(0);                                  // no Photoshoot figures yet
  const custom = take((book.ordered[shpHoldKey(sku)] || 0) + fgiHeld(sku, hold));
  const air = take(lanes.air), sea = take(lanes.sea), awd = take(lanes.awd);
  return { photo, custom, air, sea, awd, excess: left };
}

/* ---- FBA ---- */
/** Pieces FBA may take without a release. */
function fgaFbaShare(sku, current, hold, book = fgaBook()) {
  const s = fgaShares(sku, current, hold, book);
  return s.air + s.sea + s.awd;
}
const fgaShortWhy = s => `${s.sku} has ${nf(s.free)} piece(s) free for FBA, not ${nf(s.qty)} (the rest is kept for Custom orders, or is more than Replenishment asks to send).`
  + ' Send fewer, or ask an admin to release pieces on Finished Goods.';

/* ---- issues ---- */
/** Pieces an order is still waiting for: its open lines of the SKU, less what was issued to it. */
function fgaPendingOf(orderNo, sku, book) {
  const key = shpHoldKey(sku);
  const lines = book.open.filter(l => l.orderNo === obUC(orderNo) && shpHoldKey(l.sku) === key);
  return shpHoldBuild(lines.map(fgaClaim), book.rows)[key] || 0;
}
/** Rows of one save that share a SKU, as one: the pieces, and the pieces named for each order. */
function fgaBySku(wants) {
  const out = new Map();
  wants.forEach(w => {
    const key = shpHoldKey(w.sku), had = out.get(key) || { sku: obUC(w.sku), current: w.current, qty: 0, orders: new Map() };
    had.qty += fgiNum(w.qty);
    (w.orders || []).forEach(p => had.orders.set(obUC(p.orderNo), (had.orders.get(obUC(p.orderNo)) || 0) + fgiNum(p.qty)));
    out.set(key, had);
  });
  return [...out.values()];
}
/** Why one SKU's issue cannot be made, or ''. */
function fgaIssueShortWhy(w, hold, book) {
  const current = w.current === undefined ? fgiOf(w.sku).current : w.current;
  const shares = fgaShares(w.sku, current, hold, book), old = fgiFbaAgeWhy(hold);
  const forOrders = [...w.orders].reduce((n, [orderNo, qty]) => n + Math.min(qty, fgaPendingOf(orderNo, w.sku, book)), 0);
  const own = Math.min(forOrders, shares.custom), excess = old ? 0 : shares.excess;
  if (w.qty <= own + excess) return '';
  if (old) return `${w.sku}: only ${nf(own)} piece(s) can be issued for the order(s) named. ${old}`;
  return `${w.sku} has ${nf(own + excess)} piece(s) free for this issue, not ${nf(w.qty)} (${nf(own)} kept for the order(s) named, ${nf(excess)} Excess).`
    + ' Issue fewer, or name the order the pieces are for.';
}
/** Why these issues cannot leave the store, or ''. wants: [{ sku, qty, orders: [{ orderNo, qty }], current?, without? }];
 *  no orders = not for an order. */
function fgaIssueRefusal(wants, hold = fgiHoldNode()) {
  if (!fgaOn() || !wants.length) return '';
  const book = fgaBook(new Set(wants.map(w => w.without).filter(Boolean)));
  return fgaBySku(wants).map(w => fgaIssueShortWhy(w, hold, book)).filter(Boolean).join(' ');
}
/** What an edit of a movement newly issues, as fgaIssueRefusal wants it: [] when it issues nothing more. */
function fgaIssueEditWants(was, now) {
  if (now.txnType !== 'ISSUE') return [];
  const sku = obUC(now.sku), sameSku = sku === obUC(was.sku);
  const named = qty => shpHoldPartsOf(now).map(p => ({ orderNo: p.orderNo, qty }));
  if (sameSku && was.txnType === 'ISSUE') {
    const more = fgiNum(now.qty) - fgiNum(was.qty);
    return more > 0 ? [{ sku, qty: more, orders: named(more), current: fgiOf(sku).current }] : [];
  }
  const qty = fgiNum(now.qty);
  return [{ sku, qty, orders: named(qty), current: fgiOf(sku).current - (sameSku ? fgiEffect(was) : 0), without: was._id || was.id }];
}

/* ---- on the Finished Goods stock list ---- */
/** Which FBA lanes the list shows: both stores, or the one picked. */
function fgaViewStores() {
  const picked = ($('fgaView') || {}).value;
  return SHP_HOLD_STORES.includes(picked) ? [picked] : SHP_HOLD_STORES;
}
/** The list's rows with their shares; new rows are returned. */
function fgaListRows(rows) {
  const book = fgaBook(), hold = fgiHoldNode(), stores = fgaViewStores();
  return rows.map(r => Object.assign({}, r, { alloc: fgaShares(r.sku, r.current, hold, book, stores) }));
}
const fgaNum = n => (n ? nf(n) : '<span class="muted">—</span>');
function fgaCells(r) {
  const tone = r.current > 0 ? 'var(--accent)' : (r.current < 0 ? 'var(--bad)' : 'var(--muted)');
  return `<td class="num" style="font-weight:700;color:${tone}">${nf(Math.max(0, r.current))}</td>`
    + FGA_SHARES.map(([k]) => `<td class="num">${fgaNum(r.alloc[k])}</td>`).join('');
}
const fgaCardFigs = r => FGA_SHARES.map(([k, label]) => `<span>${label} <b>${nf(r.alloc[k])}</b></span>`).join('');
/** Is some of this stock kept from FBA, so a release would mean something? */
const fgaKeptBack = shares => !!shares && shares.photo + shares.custom + shares.excess > 0;
const fgaExportHead = () => ['SKU', 'Brand', 'Item', 'Subtype', 'Colour', 'Size', 'In Stock', ...FGA_SHARES.map(s => s[1])];
const fgaExportRow = r => [r.sku, r.brand, r.articleType, r.subtype, r.color, r.size, Math.max(0, r.current), ...FGA_SHARES.map(([k]) => r.alloc[k])];
