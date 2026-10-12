/* ================= PACK CORE (2026-10-12) =================
 *
 * The one set of rules both scanning screens pack by — Scan to pack (phone, Packing List tab) and Pack & verify
 * (desktop, Finished Goods tab). Merged from Ravi's "Pack & verify" hand-over of 12 Oct: its pure core, re-shaped onto
 * the Packing List document so that ONE record (packlist/{id}) is the list, the session and what Finish wrote.
 *
 *   p.boxes[].items[]   { sku, desc, size, material, qty, perPcsWt }      the Packing List tab's own shape
 *   p.scan              { orders: [orderNo…], plan: [{sku, qty}], planNo, handoverTo,
 *                         packed: { SKU: { orderNo: n } }, wrong: [{at, code, sku}], ledgerIds: [], done }
 *
 * WHAT A SCAN CAN BE, against the orders of a list:
 *   good    on an order with pieces left               → counted, oldest order first
 *   short   fewer pieces left than the scan asked for  → counted up to what is left, the rest refused
 *   full    on the orders, every line already packed   → not counted ('order'), or the India Store holds no more for
 *                                                        them ('store' — receive it in Finished Goods first)
 *   wrong   a known SKU on none of the list's orders   → NOT counted, listed under Wrong article (Ravi: block it)
 *   unknown not a SKU and not an FNSKU                 → not counted
 * A list with no orders has no guard: every known code counts (Ravi, 10 Oct: "scan se hi bane").
 *
 * PACK_CORE is pure and checked in node (tests/pack-core-test.js). packOrderLines / packLedgerWrite below it read the
 * app and write the ledger, and are what both screens call so the two can never disagree. */

const PACK_CORE = (() => {
  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };

  /** Order lines per SKU with what this list has packed against each: [{orderNo, qty, store, got, left, plan}]. */
  function lines(orderLines, packed) {
    const bySku = new Map();
    (orderLines || []).forEach(o => {
      const sku = up(o && o.sku); if (!sku || !o.orderNo) return;
      const got = num(((packed || {})[sku] || {})[o.orderNo]);
      const qty = num(o.qty), store = num(o.store);
      const l = { orderNo: o.orderNo, qty, store, got, left: Math.max(0, Math.min(qty, store) - got), plan: !!o.plan };
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push(l);
    });
    return bySku;
  }

  /** n pieces of a resolved scan ({sku}) against the order lines. Mutates `packed` for what it takes, nothing else.
   *  { kind: unknown | wrong | full | short | good, sku, taken, parts: [{orderNo, qty}], orderNo, left, why } */
  function apply(hit, orderLines, packed, n) {
    const want = Math.max(1, Math.floor(num(n)) || 1);
    if (!hit || !hit.sku) return { kind: 'unknown', taken: 0, parts: [] };
    const sku = up(hit.sku);
    const ls = lines(orderLines, packed).get(sku);
    if (!ls) return { kind: 'wrong', sku, taken: 0, parts: [] };
    let left = want; const parts = [];
    for (const l of ls) { if (left <= 0) break; const q = Math.min(left, l.left); if (q <= 0) continue; parts.push({ orderNo: l.orderNo, qty: q }); left -= q; }
    if (!parts.length) {
      const capped = ls.some(l => l.qty - l.got > 0 && l.store - l.got <= 0);
      return { kind: 'full', sku, why: capped ? 'store' : 'order', taken: 0, parts: [] };
    }
    packed[sku] = packed[sku] || {};
    parts.forEach(p => { packed[sku][p.orderNo] = num(packed[sku][p.orderNo]) + p.qty; });
    const taken = want - left;
    const after = lines(orderLines, packed).get(sku) || [];
    return { kind: taken < want ? 'short' : 'good', sku, taken, parts, orderNo: parts[0].orderNo, left: after.reduce((s, l) => s + l.left, 0) };
  }

  /** Undo: the parts go back to their orders. */
  function untake(packed, sku, parts) {
    const k = up(sku), m = packed && packed[k]; if (!m) return;
    (parts || []).forEach(p => { m[p.orderNo] = Math.max(0, num(m[p.orderNo]) - num(p.qty)); if (!m[p.orderNo]) delete m[p.orderNo]; });
    if (!Object.keys(m).length) delete packed[k];
  }

  /** How many pieces every order line still wants, per SKU, after what is packed: [{sku, left, qty, got}]. */
  function leftBySku(orderLines, packed) {
    return [...lines(orderLines, packed).entries()].map(([sku, ls]) => ({
      sku, qty: ls.reduce((s, l) => s + l.qty, 0), got: ls.reduce((s, l) => s + l.got, 0), left: ls.reduce((s, l) => s + l.left, 0),
    })).sort((a, b) => (b.left > 0) - (a.left > 0) || a.sku.localeCompare(b.sku));
  }

  /* ---- boxes, in the Packing List shape ---- */
  const boxQty = box => ((box && box.items) || []).reduce((s, it) => s + num(it.qty), 0);
  const itemOf = (box, sku) => ((box && box.items) || []).find(it => up(it.sku) === up(sku)) || null;
  /** n more of a SKU in a box; the line is made from `info` (pkLookupSku) the first time. Returns the line. */
  function addToBox(box, sku, n, info) {
    const k = up(sku); let it = itemOf(box, k);
    if (!it) {
      const i = info || {};
      it = { sku: k, desc: i.desc || k, size: i.size || '', material: i.material || '100% COTTON', qty: 0, perPcsWt: num(i.perPcsWt) };
      box.items = (box.items || []).concat([it]);
    }
    it.qty = num(it.qty) + num(n);
    return it;
  }
  /** n fewer; a line at zero goes. Returns the line's qty after, or -1 when the SKU was not in the box. */
  function takeFromBox(box, sku, n) {
    const it = itemOf(box, sku); if (!it) return -1;
    it.qty = num(it.qty) - num(n);
    if (it.qty <= 0) { box.items = box.items.filter(x => x !== it); return 0; }
    return it.qty;
  }

  /** Per-piece weight: typed in the master wins; else the mean of typed weights of the same sub-category and size;
   *  else the same sub-category; else nothing. `approx` says which. */
  function weightOf(sku, wtMaster, meta, all) {
    const k = up(sku), typed = num((wtMaster || {})[k]);
    if (typed > 0) return { wt: typed, approx: false, how: 'master' };
    const me = (meta || {})[k] || {};
    const pool = same => {
      const ws = (all || []).filter(s => s !== k && num(wtMaster[s]) > 0 && same(meta[s] || {})).map(s => num(wtMaster[s]));
      return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 0;
    };
    let w = me.subcat && me.size ? pool(m => m.subcat === me.subcat && m.size === me.size) : 0;
    if (w) return { wt: Math.round(w * 1000) / 1000, approx: true, how: 'same sub-category and size' };
    w = me.subcat ? pool(m => m.subcat === me.subcat) : 0;
    if (w) return { wt: Math.round(w * 1000) / 1000, approx: true, how: 'same sub-category' };
    return { wt: 0, approx: true, how: 'no figure anywhere' };
  }

  /** Box weights the Packing List way. `wtOf(sku)` may be given; else the line's own perPcsWt. A typed gross wins. */
  function boxWeights(box, wtOf, pkgWt, volDiv) {
    const net = ((box && box.items) || []).reduce((s, it) => s + num(it.qty) * (wtOf ? num(wtOf(it.sku)) : num(it.perPcsWt)), 0);
    const g = box && box.grossWtOverride;
    const gross = g !== '' && g != null && num(g) > 0 ? num(g) : net + num(pkgWt);
    const L = num(box && box.L), W = num(box && box.W), H = num(box && box.H);
    return { net, gross, vol: L * W * H / (num(volDiv) || 5000), cbm: L * W * H / 1e6 };
  }

  /** Amazon's Send to Amazon pack list, or any sheet, pasted: a SKU column and a Quantity column, named like Amazon
   *  names them; tabs or commas. { lines: [{sku, qty}], why } — `why` is set when nothing could be read. */
  function planParse(text) {
    const rows = String(text || '').split(/\r?\n/).map(l => l.split(/\t|,/).map(c => c.trim().replace(/^"|"$/g, ''))).filter(r => r.some(Boolean));
    if (!rows.length) return { lines: [], why: 'Nothing pasted.' };
    const head = rows[0].map(h => h.toLowerCase());
    const si = head.findIndex(h => /^(merchant[- ]?sku|seller[- ]?sku|sku|msku)$/.test(h));
    const qi = head.findIndex(h => /^(quantity|qty|expected quantity|units|shipped|quantity to ship)$/.test(h));
    if (si < 0 || qi < 0) return { lines: [], why: 'Could not find a SKU column and a Quantity column in the first row.' };
    const byS = new Map();
    rows.slice(1).forEach(r => { const s = up(r[si]), q = parseInt(r[qi], 10) || 0; if (s && q > 0) byS.set(s, (byS.get(s) || 0) + q); });
    const lines = [...byS.entries()].map(([sku, qty]) => ({ sku, qty }));
    return { lines, why: lines.length ? '' : 'No row carried a SKU and a quantity.' };
  }

  /** The Send to FBA rows a finished list writes: one per SKU with the boxes it sits in. Pieces packed against Order
   *  Console orders name those orders as packed; the rest (a pasted plan, a list with no orders, pieces past the orders)
   *  are dealt to open orders by `allot(sku, n, takenMap)` — the Auto way a typed dispatch uses. */
  function ledgerRows(p, o) {
    const sc = (p && p.scan) || {}, packed = sc.packed || {}, planNo = sc.planNo || '';
    const bySku = new Map();
    (p.boxes || []).forEach(b => (b.items || []).forEach(it => {
      const sku = up(it.sku), q = num(it.qty); if (!sku || q <= 0) return;
      const r = bySku.get(sku) || { sku, qty: 0, boxes: [] };
      r.qty += q; r.boxes.push({ n: num(b.n), qty: q }); bySku.set(sku, r);
    }));
    const m = String(p.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = m ? `${m[3]}/${m[2]}/${m[1]}` : (p.date || '');
    return [...bySku.values()].map(r => {
      const parts = new Map();
      Object.entries(packed[r.sku] || {}).forEach(([no, q]) => { if (no && no !== planNo && num(q) > 0) parts.set(no, num(q)); });
      const onOrders = [...parts.values()].reduce((s, q) => s + q, 0);
      const rest = r.qty - onOrders;
      if (rest > 0 && o.allot) {
        const al = o.allot(r.sku, rest, new Map(parts)) || {};
        (al.orders || []).forEach(x => { if (x && x.orderNo && num(x.qty) > 0) parts.set(x.orderNo, (parts.get(x.orderNo) || 0) + num(x.qty)); });
      }
      const orders = [...parts.entries()].map(([orderNo, qty]) => ({ orderNo, qty }));
      return Object.assign({ _id: o.newId(), txnType: 'FBA', sku: r.sku, qty: r.qty, date, reason: '', scanned: true },
        orders.length ? { orders } : {},
        { issuedFor: p.account || '' },
        (o.handoverTo || sc.handoverTo) ? { handoverTo: o.handoverTo || sc.handoverTo } : {},
        { packId: p.id, boxes: r.boxes, remarks: 'scanned · pack ' + p.id + (planNo ? ' · plan ' + planNo : ''),
          createdAt: o.nowIso, createdBy: o.by || '' });
    });
  }

  return { lines, apply, untake, leftBySku, boxQty, itemOf, addToBox, takeFromBox, weightOf, boxWeights, planParse, ledgerRows };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PACK_CORE;

/* ---- the app side: what both screens read and write ---- */

/** Does this list pack against orders? (A list with none has no guard.) */
const packGuarded = p => !!(p && p.scan && ((p.scan.orders || []).length || (p.scan.plan || []).length));

/** A fresh scan block for a list. */
function packScanNew(orders, plan, planNo, handoverTo) {
  return { orders: (orders || []).map(obUC).filter(Boolean), plan: plan || [], planNo: planNo || '', handoverTo: handoverTo || '',
    packed: {}, wrong: [], ledgerIds: [], done: false };
}

/** Every order line a list can pack: the Order Console lines of its orders with the pieces the India Store holds for
 *  each (fgiOutOrders — the same cap a typed dispatch has), plus the pasted plan capped by the store as a whole.
 *  Needs the gates and the Finished Goods ledger loaded (packDataReady). */
function packOrderLines(scan) {
  const out = [];
  if (!scan) return out;
  (scan.plan || []).forEach(l => out.push({ sku: obUC(l.sku), orderNo: scan.planNo, qty: l.qty, store: fgiOf(l.sku).current, plan: true }));
  const want = new Set((scan.orders || []).map(obUC).filter(Boolean));
  if (want.size) {
    const seen = new Set();
    ordLines().forEach(l => {
      if (!want.has(l.orderNo) || seen.has(l.orderNo + '|' + l.sku)) return;
      seen.add(l.orderNo + '|' + l.sku);
      const c = fgiOutOrders(l.sku, 'FBA').find(x => x.orderNo === l.orderNo);
      out.push({ sku: l.sku, orderNo: l.orderNo, qty: l.qty, store: c ? c.store : 0 });
    });
  }
  return out;
}

/** The ledger and the gates, read once. Returns '' or why they could not be read. */
async function packDataReady() {
  try { if (FGI.rows === null) await fgiLoad(); } catch (e) { return e.message || String(e); }
  if (FGI.err && !(FGI.rows || []).length) return FGI.err;
  return '';
}

/** Order numbers typed for a list: which are not in the Order Console. */
const packOrdersUnknown = orders => (orders || []).map(obUC).filter(Boolean).filter(o => !fgiOrderKnown(o));

/** Per-piece weight for a SKU: the Packing List master, else an estimate from like SKUs (PACK_CORE.weightOf). */
function packWtOf(sku) {
  const all = Object.keys(PK_WT || {}), meta = {};
  all.concat([obUC(sku)]).forEach(s => { const m = typeof mdbOf === 'function' ? mdbOf(s) : null; meta[s] = { subcat: m ? String(m.subcat || '').trim() : '', size: m ? String(m.size || '').trim() : '' }; });
  return PACK_CORE.weightOf(sku, PK_WT || {}, meta, all);
}

/** FINISH — the Send to FBA rows for a scanned list, written ONCE (p.scan.ledgerIds remembers). The same checks a typed
 *  dispatch runs: the right, the FBA account, the stock (fgiOutCheck). Returns { err } or { rows, already }.
 *  The caller saves the list afterwards; if that save fails the ids are still on the list in memory, so pressing Finish
 *  again writes nothing twice. */
async function packLedgerWrite(p, handoverTo) {
  if (!p) return { err: 'No packing list open.' };
  p.scan = p.scan || packScanNew([], [], '', '');
  if ((p.scan.ledgerIds || []).length) return { rows: [], already: true };
  if (!fgiCanEntry()) return { err: FGI_NO_ENTRY };
  if (FGI_FBA_ACCOUNTS.indexOf(p.account) < 0) return { err: `Pick the FBA account — ${FGI_FBA_ACCOUNTS.join(' or ')}.` };
  const why = await packDataReady();
  if (why) return { err: 'Could not read the Finished Goods ledger: ' + why };
  if (handoverTo != null) p.scan.handoverTo = String(handoverTo || '').trim();
  const rows = PACK_CORE.ledgerRows(p, { newId: () => fgiNewId('FBA'), nowIso: new Date().toISOString(), by: ME.email || '',
    handoverTo: p.scan.handoverTo, allot: (sku, n, taken) => fgiOutAlloc(sku, n, 'FBA', '', taken) });
  if (!rows.length) return { err: 'Nothing packed yet — scan at least one piece.' };
  for (const r of rows) {
    const bad = fgiOutCheck(r.sku, r.qty, 'FBA', 0);
    if (bad) return { err: bad + ' Receive it in Finished Goods first, then Finish again.' };
  }
  const patch = {}; rows.forEach(r => { patch['pt_fgiLedger/' + r._id] = r; });
  await ptPatch(patch);
  FGI.rows = (FGI.rows || []).concat(rows);
  p.scan.ledgerIds = rows.map(r => r._id);
  p.scan.done = true; p.scan.doneAt = new Date().toISOString(); p.scan.doneBy = ME.email || '';
  try { fbaBadge(); fgiOverBadge(); } catch (e) { /* badges are not the write */ }
  for (const r of rows) { try { await lstAlertFor(r.sku, 'FBA', r.qty); } catch (e) { /* the alert is not the write */ } }
  return { rows };
}
