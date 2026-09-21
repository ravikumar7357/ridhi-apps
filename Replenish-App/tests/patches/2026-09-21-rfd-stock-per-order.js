/* "WITH YOU" BELONGS TO THE ORDER IT WAS TYPED ON.
 *
 * Ravi, 2026-09-21, with the VND002 screen: "vendor ne with you me add kiya 200 but need me auto
 * minus nahi hua". The 200 of 60X60 was typed on VPO-260912-5QG, but the pile was one pile per
 * printer shared oldest order first — and VPO-260912-57Z, older, with 309 of 60X60 on it and nothing
 * asked, took all 200. The printer saw "200 counted elsewhere" on the order they were looking at.
 *
 * A printer answering "what is with you" on an order is answering it FOR THAT ORDER. So a count is
 * now saved against the order it was typed on (key <stockKey>@<orderId>, orderId on the row) and
 * only that order uses it, up to what it still needs. A count with no order on it — everything saved
 * before today — keeps the old rule, shared oldest first, so nothing already on record changes
 * meaning until it is tagged.
 *
 * AND AN ASK THAT WENT PAST IT SAYS SO. VND002 asked for all 1,608 a minute after typing the 200; with
 * the 200 counted here, 200 of that ask is more than the order needs. The size row says how many, so
 * the printer can take back what they do not need.
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

/* ---- 1. reading a count: this order's own, else the old shared one ---- */
one(`/** What a printer has said is with them, per size. Their own branch in the portal, the lot in the office. */
const rfdStockOf = (code, stockKey) => {
  const r = ((RFD.stock || {})[obUC(code)] || {})[stockKey];
  const n = r ? parseFloat(r.pcs) : 0;
  if (!(isFinite(n) && n > 0)) return 0;
  /* Half a tablecloth is not a thing; half a metre of cloth is. */
  return rfdKeyUnit(stockKey) === 'm' ? rfdRound(n) : Math.round(n);
};
const rfdStockRow = (code, stockKey) => ((RFD.stock || {})[obUC(code)] || {})[stockKey] || null;`,
`/** One count as a number. Half a tablecloth is not a thing; half a metre of cloth is. */
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
};`, 'reading a count');

/* ---- 2. how much of it this order may count ---- */
one(`function rfdStockHere(o, stockKey) {
  const code = rfdVendorOf(o);
  let pool = rfdStockOf(code, stockKey);
  if (!(pool > 0) || !o) return 0;
  let mine = 0;
  rfdStockOrders(code).forEach(x => {
    if (pool <= 0) return;
    const take = Math.min(pool, rfdRoomFor(x, stockKey));
    pool -= take;
    if (x.id === o.id) mine = take;
  });
  return rfdRound(mine);
}`,
`function rfdStockHere(o, stockKey) {
  if (!o) return 0;
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
}`, 'own count first');

one(`    return Object.assign(g, { stock, pool: rfdStockOf(rfdVendorOf(o), g.stockKey),`,
`    return Object.assign(g, { stock, pool: rfdStockOf(rfdVendorOf(o), g.stockKey, o),
      own: rfdStockOwn(o, g.stockKey) > 0,`, 'size groups know whose count it is');

/* ---- 3. saving: against this order, and the untagged old one goes ---- */
one(`  const path = 'pt_rfdStock/' + code + '/' + stockKey;
  const gone = pcs === '' || !isFinite(n) || val === 0;
  try {
    if (gone) await ptDelete(path);
    else await ptPut(path, row);
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  if (gone) delete mine[stockKey]; else mine[stockKey] = row;
  all[code] = mine;
  RFD.stock = all;
  return '';`,
`  /* AGAINST THE ORDER IT WAS TYPED ON. An older count for the same size that is shared, or that was
   * tagged to this order, is replaced — the printer is restating it here, and leaving it would count
   * the same cloth twice. */
  row.orderId = o.id;
  const key = stockKey + '@' + o.id;
  const gone = pcs === '' || !isFinite(n) || val === 0;
  const old = rfdStockEnts(code, stockKey).filter(e => e.k !== key && (!e.oid || e.oid === o.id)).map(e => e.k);
  const patch = { ['pt_rfdStock/' + code + '/' + key]: gone ? null : row };
  old.forEach(k => { patch['pt_rfdStock/' + code + '/' + k] = null; });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  old.forEach(k => { delete mine[k]; });
  if (gone) delete mine[key]; else mine[key] = row;
  all[code] = mine;
  RFD.stock = all;
  return '';`, 'saved against the order');

/* ---- 4. the printer's screen: pieces ---- */
one(`    const elsewhere = rfdRound(Math.max(0, g.pool - g.stock));
    const said = rfdStockRow(rfdVendorOf(o), g.stockKey);`,
`    const elsewhere = g.own ? 0 : rfdRound(Math.max(0, g.pool - g.stock));
    const spare = g.own ? rfdRound(Math.max(0, g.pool - g.stock)) : 0;
    /* ASKED PAST WHAT IS WITH THEM: an ask raised before the count was typed still stands, and the
     * two together can be more than the order needs. Said, so it can be taken back. */
    const overAsked = rfdRound(Math.max(0, g.used + g.stock - g.pieces));
    const said = rfdStockRow(rfdVendorOf(o), g.stockKey, o);`, 'pieces: whose count');
one(`      + (g.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(g.used)} pcs asked for</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(g.pieces)} pcs</td>\``,
`      + (g.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(g.used)} pcs asked for</div>\` : '')
      + (overAsked ? \`<div style="font-size:10.5px;color:var(--bad)" title="What you asked for and what you said is with you add up to more than this order needs. Take back what you do not need.">\${nf(overAsked)} pcs more than the order needs</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(g.pieces)} pcs</td>\``, 'pieces: over-asked');
one(`      + \` title="How many of these you already have. Yours to keep up to date — it comes off what is left to ask for, on this order and the next one.">\``,
`      + \` title="How many of these you already have for THIS order. It comes off what is left to ask for on this order.">\``, 'pieces: box says this order');
one(`      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your pile is counted on your other open orders.">\${nf(elsewhere)} counted elsewhere</div>\` : '')`,
`      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your pile is counted on your other open orders.">\${nf(elsewhere)} counted elsewhere</div>\` : '')
      + (spare ? \`<div style="font-size:10.5px;color:#7f6000" title="This order only needs so many more. The rest is not counted anywhere.">\${nf(spare)} more than this order still needs</div>\` : '')`, 'pieces: spare');

/* ---- 5. the printer's screen: metres ---- */
one(`    const pool = rfdStockOf(rfdVendorOf(o), key);
    const elsewhere = rfdRound(Math.max(0, pool - cap.stock));
    const said = rfdStockRow(rfdVendorOf(o), key);`,
`    const pool = rfdStockOf(rfdVendorOf(o), key, o);
    const own = rfdStockOwn(o, key) > 0;
    const elsewhere = own ? 0 : rfdRound(Math.max(0, pool - cap.stock));
    const spare = own ? rfdRound(Math.max(0, pool - cap.stock)) : 0;
    const said = rfdStockRow(rfdVendorOf(o), key, o);`, 'metres: whose count');
one(`      + \` title="How many metres of this you already have. Yours to keep up to date — it comes off what is left to ask for, on this order and the next one.">\``,
`      + \` title="How many metres of this you already have for THIS order. It comes off what is left to ask for on this order.">\``, 'metres: box says this order');
one(`      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your cloth is counted on your other open orders.">\${nf(elsewhere)} m counted elsewhere</div>\` : '')`,
`      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your cloth is counted on your other open orders.">\${nf(elsewhere)} m counted elsewhere</div>\` : '')
      + (spare ? \`<div style="font-size:10.5px;color:#7f6000" title="This order only needs so much more. The rest is not counted anywhere.">\${nf(spare)} m more than this order still needs</div>\` : '')`, 'metres: spare');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
