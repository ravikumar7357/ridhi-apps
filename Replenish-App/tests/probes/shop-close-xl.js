/* CLOSE THE SHOPIFY-DONE LINES FROM RAVI'S SHEET (15 Oct: "isme se actual pending order hi rahe bas baki ke complete
 * kardo"). Builds the same write ordCloseRun makes (shopDoneAt / Why / By / Note / Handed / Log on every order-book row
 * of the line), writes nothing.
 *   node probes/shop-close-xl.js <backup.json> <sheet.json> <patch-out.json> <by-email>
 * sheet.json: { "Done on Shopify - still open": [{order, store, says, sku}], "Still open on Shopify": [...] }
 * A row is matched to an open SHP/ONL line by Shopify order name + SKU; anything not matched, already closed or handed
 * over is reported, not written. Lines on "Still open on Shopify" are never touched. */
const fs = require('fs');
const { lines, B } = require('./cleanup-plan.js');
const X = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), out = process.argv[4], by = process.argv[5];
const U = s => String(s == null ? '' : s).trim().toUpperCase();
const nm = s => U(s).replace(/^#/, '');
const WHY = { 'FULFILLED ON SHOPIFY': 'fulfilled', 'CANCELLED ON SHOPIFY': 'cancelled', 'REFUNDED ON SHOPIFY': 'refunded' };
const ob = Object.entries(B.pt_orderBook || {}).filter(([, r]) => r);
const byName = new Map();
lines.filter(l => /^(SHP|ONL)-/.test(U(l.orderNo))).forEach(l => {
  const names = new Set(ob.filter(([, r]) => U(r.orderNo) === U(l.orderNo) && U(r.sku) === U(l.sku)).map(([, r]) => nm(r.shopOrderNo)).filter(Boolean));
  names.add(nm(String(l.orderNo).replace(/^(SHP|ONL)-/i, '')));
  names.forEach(n => { const k = n + '|' + U(l.sku); (byName.get(k) || byName.set(k, []).get(k)).push(l); });
});
const keepOpen = new Set((X['Still open on Shopify'] || []).map(r => nm(r.order) + '|' + U(r.sku)));
const now = new Date().toISOString(), patch = {}, rep = { closed: 0, why: {}, notFound: [], ambiguous: [], already: [], handed: [], clash: [] };
(X['Done on Shopify - still open'] || []).forEach(x => {
  const k = nm(x.order) + '|' + U(x.sku), why = WHY[U(x.says)];
  if (!why) { rep.notFound.push(k + ' (says ' + x.says + ')'); return; }
  if (keepOpen.has(k)) { rep.clash.push(k); return; }
  const ls = byName.get(k) || [];
  if (!ls.length) { rep.notFound.push(k); return; }
  if (ls.length > 1) { rep.ambiguous.push(k + ' → ' + ls.map(l => l.orderNo).join(', ')); return; }
  const l = ls[0];
  if (l.handedAt) { rep.handed.push(k); return; }
  if (!l.open) { rep.already.push(k + ' (' + (l.shopDoneWhy || 'closed') + ')'); return; }
  const handed = 0;
  ob.filter(([, r]) => U(r.orderNo) === U(l.orderNo) && U(r.sku) === U(l.sku)).forEach(([key, r]) => {
    const log = (Array.isArray(r.shopDoneLog) ? r.shopDoneLog.slice(-19) : []).concat([{ act: 'close', why, note: 'Ravi 15 Oct sheet: ' + x.says, at: now, by, handed }]);
    Object.assign(patch, { ['pt_orderBook/' + key + '/shopDoneAt']: now, ['pt_orderBook/' + key + '/shopDoneWhy']: why,
      ['pt_orderBook/' + key + '/shopDoneBy']: by, ['pt_orderBook/' + key + '/shopDoneNote']: 'Ravi 15 Oct sheet: ' + x.says,
      ['pt_orderBook/' + key + '/shopDoneHanded']: handed, ['pt_orderBook/' + key + '/shopDoneLog']: log });
  });
  rep.closed++; rep.why[why] = (rep.why[why] || 0) + 1;
});
// What stays open afterwards, against the sheet's own "still open" list.
const closing = new Set(Object.keys(patch).map(p => p.split('/')[1]));
const openAfter = lines.filter(l => /^(SHP|ONL)-/.test(U(l.orderNo)) && l.open
  && !ob.some(([key, r]) => closing.has(key) && U(r.orderNo) === U(l.orderNo) && U(r.sku) === U(l.sku)));
const inSheet = openAfter.filter(l => [...byName.entries()].some(([k, v]) => v.includes(l) && keepOpen.has(k)));
fs.writeFileSync(out, JSON.stringify(patch));
console.log(JSON.stringify({ closed: rep.closed, why: rep.why, paths: Object.keys(patch).length, openAfter: openAfter.length, openAfterOnStillOpenSheet: inSheet.length }));
['notFound', 'ambiguous', 'already', 'handed', 'clash'].forEach(n => rep[n].length && console.log(n, rep[n].length + ':', rep[n].slice(0, 15).join(' ; ')));
const extra = openAfter.filter(l => !inSheet.includes(l));
if (extra.length) console.log('open, not on the still-open sheet', extra.length + ':', extra.slice(0, 25).map(l => l.orderNo + ' ' + l.sku).join(', '));
