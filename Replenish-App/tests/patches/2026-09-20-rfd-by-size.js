/* ONE ROW PER SIZE, AND A BOX FOR WHAT THE PRINTER ALREADY HAS.
 *
 * "alag alag color me same size required h entry ka manual work bahut h - pahle size ka unique kro
 * and then auto color wise auto spread honi chahiye" · "with you qty open field honi chahiye usme
 * vendor apna stock add kar sake and future me wo auto count ho".
 *
 * WHY THE COLOUR SPLIT WAS WORK WITHOUT A REASON. A printer is asking for BLANK cloth, already cut
 * to size. The colour is what they are about to print ON it. So 60X60 Square Tablecloth appearing
 * thirteen times, once per colour, asks somebody to do thirteen sums to answer one question.
 * Measured on the live orders: 1,038 rows become 260 - 75% fewer. Ravi's own screen, VPO-260911-BRG:
 * 113 rows become 21, and 60X60 Square Tablecloth is one line of 1,576 pcs over 13 colours.
 *
 * AND THE GROUP IS HONEST. 5 of those 260 size groups have colours that name different cloth, and
 * two of the five are the "Sheeitng 112" typo. The row says so - every cloth behind it is named -
 * and nothing about the STORED ask changes: a request is still written per SKU, with its own colour
 * and its own fabric, so approvals, ceilings, sends and the office screens are untouched. The group
 * is how it is asked for, not how it is kept.
 *
 * WHAT IS WITH YOU IS NOW A BOX YOU FILL IN. It was "already sent against this order" and a dash on
 * every row. A printer with cloth on the floor had no way to say so, so the office kept sending
 * against a requirement that was already met. The figure they type is their own count, held per
 * printer and per size in pt_rfdStock, and it comes off what is left to ask for - here and on every
 * later order, which is the "future me auto count" part.
 *
 * A DECLARED PILE IS ONE PILE. 39 size groups sit on two or three OPEN orders of the same printer -
 * VND001 has 60X60 on three at once. Counting a declaration against each would count the same cloth
 * three times and stop the factory sending anything. So the pile is ALLOCATED: the printer's open
 * orders take from it oldest first, each up to what it still needs, and the row says where the rest
 * of it went.
 *
 * IT NEVER REWRITES HISTORY. rfdPcsAllowed subtracts the pile only when asked what is left for a NEW
 * request. Asked what was left at the moment an old request was raised - which is what decides
 * whether it was auto-approved - it answers exactly what it answered before. A count typed today
 * cannot turn last week's agreed request back into one that needs approval.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. `used` comes out of rfdPcsAllowed, so the size groups can have it without recursing ---- */
one(`function rfdPcsAllowed(o, sku, before) {
  const line = rfdPieceOf(o, sku);
  const need = line ? line.pieces : 0;
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  const used = rfdReqsOf(o).reduce((a, r) => {
    if (rfdUnit(r) !== 'pcs' || obUC(r.sku) !== obUC(sku)) return a;
    if (exceptId && r.id === exceptId) return a;
    if (cut && rfdSeq(r) >= cut) return a;
    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.pieces) || 0);
  }, 0);
  return { need: rfdRound(need), used: rfdRound(used), left: rfdRound(Math.max(0, need - used)) };
}`,
`/**
 * How many pieces of one size have already been asked for on this order.
 *
 * Lifted out of rfdPcsAllowed so the size groups can ask for it WITHOUT asking for "what is left" —
 * which now depends on the declared pile, which is worked out from the size groups. Calling the
 * whole thing there would have been a loop with no bottom.
 */
function rfdUsedPcs(o, sku, before) {
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  return rfdReqsOf(o).reduce((a, r) => {
    if (rfdUnit(r) !== 'pcs' || obUC(r.sku) !== obUC(sku)) return a;
    if (exceptId && r.id === exceptId) return a;
    if (cut && rfdSeq(r) >= cut) return a;
    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.pieces) || 0);
  }, 0);
}

function rfdPcsAllowed(o, sku, before) {
  const line = rfdPieceOf(o, sku);
  const need = line ? line.pieces : 0;
  const used = rfdUsedPcs(o, sku, before);
  /* WHAT THE PRINTER SAYS IS ALREADY WITH THEM comes off what is left to ask for — but only when we
   * are asked about a NEW request. \`before\` means "what was left at the moment that one was raised",
   * and that answer decided whether it was agreed on the spot; a count typed today must not reach
   * back and turn an agreed request into one that needs approval. */
  const stock = before ? 0 : rfdStockForSku(o, sku);
  return { need: rfdRound(need), used: rfdRound(used), stock: rfdRound(stock),
    left: rfdRound(Math.max(0, need - used - stock)) };
}`, 'used comes out on its own');

/* ---- 2. sizes, the pile, and the spread ---- */
one(`const rfdPieceOf = (o, sku) => rfdPieceLines(o).find(x => obUC(x.sku) === obUC(sku)) || null;`,
`const rfdPieceOf = (o, sku) => rfdPieceLines(o).find(x => obUC(x.sku) === obUC(sku)) || null;

/* ================= A SIZE, NOT A SIZE PER COLOUR =================
 *
 * A printer asks for blank cloth cut to a size; the colour is what they are about to print on it.
 * Listing 60X60 Square Tablecloth once per colour asked somebody to do thirteen sums to answer one
 * question. These collapse the order to one row per size. The stored request is still per SKU.
 */
const rfdSizeKey = x => [String((x && x.what) || ''), String((x && x.size) || '')]
  .map(v => v.trim().toLowerCase()).join(' | ');
/** The same group as a key a database will take: no dots, slashes, brackets or hashes. */
const rfdStockKey = x => rfdSizeKey(x).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';

/**
 * The order's pieces by size — BEFORE the declared pile is counted.
 *
 * The pile is allocated across orders by looking at what each one still needs, which is worked out
 * from here, so this one has to be answerable without it.
 */
function rfdSizeRaw(o) {
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
  return rfdSizeRaw(o).map(g => {
    const stock = rfdStockHere(o, g.stockKey);
    return Object.assign(g, { stock, pool: rfdStockOf(rfdVendorOf(o), g.stockKey),
      left: rfdRound(Math.max(0, g.pieces - g.used - stock)) });
  });
}
const rfdSizeOf = (o, key) => rfdSizeGroups(o).find(g => g.key === key || g.stockKey === key) || null;

const rfdVendorOf = o => obUC((o && o.vendorCode) || VP.code || '');
/** What a printer has said is with them, per size. Their own branch in the portal, the lot in the office. */
const rfdStockOf = (code, stockKey) => {
  const r = ((RFD.stock || {})[obUC(code)] || {})[stockKey];
  const n = r ? parseFloat(r.pcs) : 0;
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const rfdStockRow = (code, stockKey) => ((RFD.stock || {})[obUC(code)] || {})[stockKey] || null;

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
function rfdStockHere(o, stockKey) {
  const code = rfdVendorOf(o);
  let pool = rfdStockOf(code, stockKey);
  if (!(pool > 0) || !o) return 0;
  let mine = 0;
  rfdStockOrders(code).forEach(x => {
    if (pool <= 0) return;
    const g = rfdSizeRaw(x).find(y => y.stockKey === stockKey);
    if (!g) return;
    const take = Math.min(pool, Math.max(0, g.pieces - g.used));
    pool -= take;
    if (x.id === o.id) mine = take;
  });
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
function rfdSpread(total, rooms) {
  const w = (rooms || []).map(x => Math.max(0, Math.floor(parseFloat(x) || 0)));
  const out = w.map(() => 0);
  const room = w.reduce((a, b) => a + b, 0);
  let left = Math.min(Math.max(0, Math.round(parseFloat(total) || 0)), room);
  if (!left) return out;
  const exact = w.map(x => (x / room) * left);
  exact.forEach((v, i) => { out[i] = Math.min(w[i], Math.floor(v)); });
  left -= out.reduce((a, b) => a + b, 0);
  w.map((x, i) => ({ i, rem: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.rem - a.rem || w[b.i] - w[a.i] || a.i - b.i)
    .forEach(x => { if (left > 0 && out[x.i] < w[x.i]) { out[x.i]++; left--; } });
  /* A second pass: a part already at its own ceiling could not take its share, and those pieces
   * belong to somebody rather than to nobody. */
  while (left > 0) {
    let moved = false;
    for (let i = 0; i < out.length && left > 0; i++) if (out[i] < w[i]) { out[i]++; left--; moved = true; }
    if (!moved) break;
  }
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
async function rfdSubmitSize(o, key, pieces, note) {
  if (!o) return 'That order is no longer here.';
  const g = rfdSizeOf(o, key);
  if (!g) return 'Pick which size you need.';
  const want = parseFloat(pieces) || 0;
  if (!(want > 0)) return 'How many pieces do you need?';
  if (Math.round(want) !== want) return 'Pieces have to be a whole number.';
  /* SPREAD OVER WHAT EACH COLOUR STILL NEEDS. Asking for more than the size needs is allowed — it
   * goes to the office to approve — so the room is stretched to fit rather than the ask trimmed. */
  const rooms = g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku) - rfdStockForSku(o, x.sku)));
  const total = rooms.reduce((a, b) => a + b, 0);
  const share = rfdSpread(want, total >= want ? rooms : g.skus.map(x => x.pieces));
  const asks = [];
  g.skus.forEach((x, i) => {
    if (!(share[i] > 0)) return;
    asks.push({ unit: 'pcs', pieces: share[i], sku: x.sku, size: x.size, what: x.what,
      colour: x.colour, fabric: x.fabric, metres: x.per ? rfdRound(share[i] * x.per) : 0 });
  });
  if (!asks.length) return 'There is nothing left to ask for on that size.';
  const recs = asks.map((a, i) => rfdRecord(o, a, note, i + 1));
  const base = 'pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/';
  const patch = {};
  recs.forEach(r => { patch[base + r.id] = r; });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  rfdKeep(o, recs);
  return '';
}

/**
 * The printer's own count of what is on their floor, per size.
 *
 * Their own branch and nobody else's. It is a DECLARATION, not a receipt — it is stamped with who
 * said it and when, and the office sees both, because it comes off what the factory will send.
 */
async function rfdStockSave(o, stockKey, pcs) {
  const code = rfdVendorOf(o);
  if (!code) return 'This sign-in is not linked to a printer.';
  const g = rfdSizeOf(o, stockKey);
  const n = parseFloat(pcs);
  if (pcs !== '' && (!isFinite(n) || n < 0)) return 'How many pieces do you have? A number, or leave it empty.';
  if (isFinite(n) && Math.round(n) !== n) return 'Pieces have to be a whole number.';
  const path = 'pt_rfdStock/' + code + '/' + stockKey;
  try {
    if (pcs === '' || !isFinite(n) || n === 0) await ptDelete(path);
    else await ptPut(path, { pcs: Math.round(n), what: (g && g.what) || '', size: (g && g.size) || '',
      by: ME.email, at: new Date().toISOString() });
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  if (pcs === '' || !isFinite(n) || n === 0) delete mine[stockKey];
  else mine[stockKey] = { pcs: Math.round(n), what: (g && g.what) || '', size: (g && g.size) || '',
    by: ME.email, at: new Date().toISOString() };
  all[code] = mine;
  RFD.stock = all;
  return '';
}`, 'sizes, the pile and the spread');

/* ---- 3. the state carries it ---- */
one(`let RFD = { decisions: null, err: '', busy: false, at: '', shown: [] };`,
`let RFD = { decisions: null, err: '', busy: false, at: '', shown: [], stock: {} };`, 'the state');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
