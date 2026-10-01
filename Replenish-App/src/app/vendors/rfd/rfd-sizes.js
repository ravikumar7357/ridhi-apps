/* ================= A SIZE, NOT A SIZE PER COLOUR =================
 *
 * A printer asks for blank cloth cut to a size; the colour is what they are about to print on it.
 * Listing 60X60 Square Tablecloth once per colour asked somebody to do thirteen sums to answer one
 * question. These collapse the order to one row per size. The stored request is still per SKU.
 */
const rfdSizeKey = x => [String((x && x.what) || ''), String((x && x.size) || '')]
  .map(v => v.trim().toLowerCase()).join(' | ');
/** The same group as a key a database will take: no dots, slashes, brackets or hashes. */
const rfdKeySafe = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
/* P__ for a size in pieces, M__ for a cloth in metres. Apart, so a fabric named like a size cannot
 * land on the same row, and so the unit is readable in the key. */
const rfdStockKey = x => 'P__' + rfdKeySafe(rfdSizeKey(x));
const rfdFabKey = f => 'M__' + rfdKeySafe(f);
const rfdKeyUnit = k => (String(k || '').indexOf('M__') === 0 ? 'm' : 'pcs');

/**
 * The order's pieces by size — BEFORE the declared pile is counted.
 *
 * The pile is allocated across orders by looking at what each one still needs, which is worked out
 * from here, so this one has to be answerable without it.
 */
/* ---- the draw-long memo (2026-09-26) ---- */
let RFD_MEMO = null;
function rfdMemo() {
  const sig = [RFD, RFD && RFD.stock, RFD && RFD.decisions, VO && VO.rows, VP && VP.rows, VP && VP.code];
  if (RFD_MEMO && RFD_MEMO.sig.every((x, i) => x === sig[i])) return RFD_MEMO.m;
  RFD_MEMO = { sig, m: new Map() };
  const mine = RFD_MEMO;
  Promise.resolve().then(() => { if (RFD_MEMO === mine) RFD_MEMO = null; });
  return RFD_MEMO.m;
}
/** Remember f's answer for this key until the draw is over. Keyed by the order object and its requests' identity. */
function rfdMemoOf(kind, o, key, f) {
  const m = rfdMemo();
  let per = m.get(o);
  if (!per || per.reqs !== (o && o.rfdReqs)) { per = { reqs: o && o.rfdReqs, v: new Map() }; m.set(o, per); }
  const k = kind + '|' + (key || '');
  if (!per.v.has(k)) per.v.set(k, f());
  return per.v.get(k);
}

function rfdSizeRaw(o) {
  return rfdMemoOf('raw', o, '', () => rfdSizeRawBuild(o));
}
function rfdSizeRawBuild(o) {
  const by = new Map();
  rfdPieceLines(o).forEach(x => {
    const k = rfdSizeKey(x);
    if (!by.has(k)) by.set(k, { key: k, stockKey: rfdStockKey(x), what: x.what, size: x.size,
      skus: [], pieces: 0, fabrics: [], colours: [], ruled: true });
    const g = by.get(k);
    g.skus.push(x); g.pieces += x.pieces;
    if (!x.ruled) g.ruled = false;
    if (x.fabric && g.fabrics.indexOf(x.fabric) < 0) g.fabrics.push(x.fabric);
    if (x.colour && g.colours.indexOf(x.colour) < 0) g.colours.push(x.colour);
  });
  return [...by.values()].map(g => Object.assign(g, {
    pieces: rfdRound(g.pieces),
    used: rfdRound(g.skus.reduce((a, x) => a + rfdUsedPcs(o, x.sku), 0)),
    sent: rfdRound(g.skus.reduce((a, x) => a + rfdSentPcsFor(o, x.sku), 0)),
  })).sort((a, b) => b.pieces - a.pieces);
}

/** The order's sizes with the pile counted in — what the screen shows. */
function rfdSizeGroups(o) {
  return rfdMemoOf('groups', o, '', () => rfdSizeRaw(o).map(g => Object.assign({}, g)).map(g => {
    const stock = rfdStockHere(o, g.stockKey);
    return Object.assign(g, { stock, pool: rfdStockOf(rfdVendorOf(o), g.stockKey, o),
      own: rfdStockOwn(o, g.stockKey) > 0,
      left: rfdRound(Math.max(0, g.pieces - g.used - stock)) });
  }));
}
const rfdSizeOf = (o, key) => rfdSizeGroups(o).find(g => g.key === key || g.stockKey === key) || null;

const rfdVendorOf = o => obUC((o && o.vendorCode) || VP.code || '');
/** One count as a number. Half a tablecloth is not a thing; half a metre of cloth is. */
const rfdStockNum = (r, stockKey) => {
  const n = r ? parseFloat(r.pcs) : 0;
  if (!(isFinite(n) && n > 0)) return 0;
  return rfdKeyUnit(stockKey) === 'm' ? rfdRound(n) : Math.round(n);
};
/**
 * Every count a printer has given for one size or cloth, with the order it belongs to.
 *
 * Saved today and after: key <stockKey>@<orderId>. Saved before: key <stockKey>, with an orderId on
 * the row once it has been tagged, and none — shared, the old way — until then.
 */
const rfdStockEnts = (code, stockKey) => Object.entries((RFD.stock || {})[obUC(code)] || {})
  .filter(([k, r]) => r && typeof r === 'object' && (k === stockKey || k.indexOf(stockKey + '@') === 0))
  .map(([k, r]) => ({ k, r, oid: String(r.orderId || (k.indexOf('@') > 0 ? k.slice(k.indexOf('@') + 1) : '')) }));
const rfdStockOwn = (o, stockKey) => (!o ? 0 : rfdStockEnts(rfdVendorOf(o), stockKey)
  .filter(e => e.oid === o.id).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0));
const rfdStockShared = (code, stockKey) => rfdStockEnts(code, stockKey)
  .filter(e => !e.oid).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
/**
 * What the printer has said is with them. Given an order: that order's own count, or — if it has
 * none — the old shared one. Given none: everything they have said about it.
 */
const rfdStockOf = (code, stockKey, o) => {
  if (o) {
    const mine = rfdStockEnts(code, stockKey).filter(e => e.oid === o.id);
    if (mine.length) return mine.reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
    return rfdStockShared(code, stockKey);
  }
  return rfdStockEnts(code, stockKey).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
};
const rfdStockRow = (code, stockKey, o) => {
  const ents = rfdStockEnts(code, stockKey);
  const e = (o && ents.find(x => x.oid === o.id)) || ents.find(x => !x.oid);
  return e ? e.r : null;
};

/** The orders of one printer that can be asked against, oldest first — the order the pile is shared in. */
const rfdStockOrders = code => {
  const src = (VP.code && obUC(VP.code) === obUC(code) && VP.rows)
    ? VP.rows : (VO.rows || []).filter(o => o && obUC(o.vendorCode) === obUC(code));
  return (src || []).filter(o => o && ['Received', 'Cancelled'].indexOf(o.status || 'Placed') < 0)
    .slice().sort((a, b) => String(a.orderNo || a.id).localeCompare(String(b.orderNo || b.id)));
};

/**
 * HOW MUCH OF THE PILE THIS ORDER MAY COUNT.
 *
 * 39 size groups sit on two or three open orders of the same printer. One declaration counted
 * against each of them would be the same cloth counted three times, and the factory would stop
 * sending against requirements that are not in fact met. So the orders take from it oldest first,
 * each up to what it still needs, and what is left over goes to the next one.
 */
/** What one order still needs of a size or of a cloth — the share of a pile it can take. */
function rfdRoomFor(o, stockKey) {
  return rfdMemoOf('room', o, stockKey, () => rfdRoomForBuild(o, stockKey));
}
function rfdRoomForBuild(o, stockKey) {
  const g = rfdSizeRaw(o).find(y => y.stockKey === stockKey);
  if (g) return Math.max(0, g.pieces - g.used);
  const f = rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey);
  if (!f) return 0;
  return Math.max(0, f.metres - rfdUsedM(o, f.fabric));
}

function rfdStockHere(o, stockKey) {
  if (!o) return 0;
  return rfdMemoOf('here', o, stockKey, () => rfdStockHereBuild(o, stockKey));
}
function rfdStockHereBuild(o, stockKey) {
  const code = rfdVendorOf(o);
  /* THIS ORDER'S OWN COUNT FIRST, up to what it still needs. */
  const ownTake = x => Math.min(rfdStockOwn(x, stockKey), rfdRoomFor(x, stockKey));
  let mine = ownTake(o);
  /* THEN ANYTHING STILL SHARED THE OLD WAY, oldest order first, into the room each has left. */
  let pool = rfdStockShared(code, stockKey);
  if (pool > 0) {
    rfdStockOrders(code).forEach(x => {
      if (pool <= 0) return;
      const take = Math.min(pool, Math.max(0, rfdRoomFor(x, stockKey) - ownTake(x)));
      pool -= take;
      if (x.id === o.id) mine += take;
    });
  }
  return rfdRound(mine);
}

/**
 * SPLIT A WHOLE NUMBER ACROSS PARTS AND LOSE NOTHING TO ROUNDING.
 *
 * Every part gets its share of the total in proportion to how much room it has, and the pieces that
 * the fractions leave over go to the largest remainders first. The result always adds up to the
 * total — or to the room available, when that is smaller — because half a tablecloth is not
 * something anybody can cut, and thirteen roundings that each lose a piece lose thirteen pieces.
 */
function rfdSpread(total, weights) {
  const t = Math.max(0, Math.round(parseFloat(total) || 0));
  let w = (weights || []).map(x => Math.max(0, parseFloat(x) || 0));
  const out = w.map(() => 0);
  if (!t || !w.length) return out;
  /* NOTHING LEFT ANYWHERE AND STILL ASKING. Asking beyond what the order covers is allowed — it goes
   * to the office to approve — so dividing by a total of nothing must share the extra out, not throw
   * it away. */
  let sum = w.reduce((a, b) => a + b, 0);
  if (!sum) { w = w.map(() => 1); sum = w.length; }
  const exact = w.map(x => (x / sum) * t);
  exact.forEach((v, i) => { out[i] = Math.floor(v); });
  let left = t - out.reduce((a, b) => a + b, 0);
  /* The pieces the fractions leave over go to the largest remainders first, so the result adds up to
   * exactly what was asked for. Thirteen colours each rounded down lose thirteen pieces. */
  w.map((x, i) => ({ i, rem: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.rem - a.rem || w[b.i] - w[a.i] || a.i - b.i)
    .forEach(x => { if (left > 0) { out[x.i]++; left--; } });
  return out;
}

/** One SKU's share of its size's pile, spread across the colours by what each still needs. */
function rfdStockForSku(o, sku) {
  const line = rfdPieceOf(o, sku);
  if (!line) return 0;
  const key = rfdStockKey(line);
  const here = rfdStockHere(o, key);
  if (!(here > 0)) return 0;
  const g = rfdSizeRaw(o).find(x => x.stockKey === key);
  if (!g) return 0;
  const i = g.skus.findIndex(x => obUC(x.sku) === obUC(sku));
  if (i < 0) return 0;
  return rfdSpread(here, g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku))))[i];
}

/**
 * Ask for a whole size at once, spread across its colours.
 *
 * The REQUEST is still one per SKU, with its own colour and its own fabric, because that is what the
 * office approves, sends and counts against. Only the typing is by size.
 */
