/* WHAT HAPPENS TODAY WHEN A QUANTITY CHANGES ON AN APPROVED ORDER. Read-only.
 *
 * Approving writes one order-book row per SKU, and soApproveRun skips a SKU the book already has:
 *   if (qty <= 0 || have.has(s)) return;
 * That is what stops a second approval duplicating production lines — and it also means a quantity
 * edited afterwards never reaches the book. This asks the live data how far the two have already
 * drifted apart, and how much room there would be to reduce a line if we let somebody.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v)) : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : o[k]))).filter(Boolean);
  const U = s => String(s == null ? '' : s).trim().toUpperCase();
  const N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const H = t => console.log('\n== ' + t + ' ==');

  const [soR, obR, cutR, baseR, pressR, fgR] = await Promise.all(
    ['pt_salesOrders', 'pt_orderBook', 'pt_cuttingData', 'pt_baseData', 'pt_pressInventory', 'pt_fgiLedger'].map(get));
  const SO = list(soR), OB = list(obR), CUT = list(cutR), BD = list(baseR), PR = list(pressR), FG = list(fgR);
  const lines = o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(Boolean);
  const key = (no, sku) => U(no) + '|' + U(sku);
  const sum = (rows, f) => { const m = {}; rows.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return;
    const k = key(r.orderNo, r.sku); m[k] = (m[k] || 0) + f(r); }); return m; };
  const cutM = sum(CUT, r => N(r.pieces) - (r.rejected === true ? N(r.rejPieces) : 0));
  const recvM = sum(BD, r => N(r.receivedPieces));
  const pressM = sum(PR, r => N(r.pieces));
  const fgM = sum(FG, r => N(r.pieces || r.qty));

  /* what the order book says, per order + SKU */
  const obM = {}; OB.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return;
    const k = key(r.orderNo, r.sku); obM[k] = (obM[k] || 0) + N(r.qty); });

  H('1. THE SALES ORDERS');
  const approved = SO.filter(o => o.status === 'approved');
  console.log('orders            : ' + SO.length + '   approved: ' + approved.length);
  console.log('approved lines    : ' + approved.reduce((a, o) => a + lines(o).length, 0));
  console.log('pieces ordered    : ' + approved.reduce((a, o) => a + lines(o).reduce((b, l) => b + N(l.qty), 0), 0));

  H('2. WHERE THE ORDER BOOK AND THE SALES ORDER ALREADY DISAGREE');
  let same = 0, miss = 0, drift = 0, driftPcs = 0; const ex = [];
  approved.forEach(o => {
    const per = new Map();
    lines(o).forEach(l => { const s = U(l.sku); if (!s) return; per.set(s, (per.get(s) || 0) + N(l.qty)); });
    per.forEach((want, s) => {
      const k = key(o._key, s);
      if (!(k in obM)) { miss++; return; }
      const have = obM[k];
      if (Math.round(have) === Math.round(want)) { same++; return; }
      drift++; driftPcs += Math.abs(have - want);
      if (ex.length < 15) ex.push([o._key, s, want, have]);
    });
  });
  console.log('SKUs that agree                           : ' + same);
  console.log('SKUs the order book never got             : ' + miss + '   (the red banner)');
  console.log('SKUs where the two DISAGREE               : ' + drift + '   (' + Math.round(driftPcs) + ' pieces apart)');
  if (ex.length) {
    console.log('\norder                SKU                    sales order   order book   difference');
    ex.forEach(([no, s, w, h]) => console.log('   ' + String(no).padEnd(20) + String(s).padEnd(22)
      + String(w).padStart(11) + String(h).padStart(13) + String(Math.round(h - w)).padStart(13)));
  }

  H('3. HOW MUCH ROOM IS THERE TO REDUCE A LINE?');
  /* A line cannot go below what has already been done against it, or the console starts hiding
   * pieces that exist. The floor is the largest of cut, received, pressed and into-store. */
  let untouched = 0, started = 0, locked = 0, totalFloor = 0;
  approved.forEach(o => {
    const per = new Map();
    lines(o).forEach(l => { const s = U(l.sku); if (!s) return; per.set(s, (per.get(s) || 0) + N(l.qty)); });
    per.forEach((want, s) => {
      const k = key(o._key, s);
      const floor = Math.max(cutM[k] || 0, recvM[k] || 0, pressM[k] || 0, fgM[k] || 0);
      totalFloor += floor;
      if (!floor) untouched++;
      else if (floor < want) started++;
      else locked++;
    });
  });
  console.log('lines nothing has been done on (can go to 0) : ' + untouched);
  console.log('lines part done (can come down, not to zero) : ' + started);
  console.log('lines already done in full (cannot come down): ' + locked);
  console.log('pieces already cut/made/pressed/stored       : ' + Math.round(totalFloor));

  H('4. AND WHAT AN INCREASE WOULD TOUCH');
  console.log('An increase never clashes with work done — it only adds. The question is whether the');
  console.log('order book row is updated with it, and today it is not: soApproveRun skips a SKU the');
  console.log('book already has, so a re-approval changes nothing.');
  const withReqs = approved.filter(o => o.qtyAdjustments).length;
  console.log('\norders that already carry a qtyAdjustments log: ' + withReqs);
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
