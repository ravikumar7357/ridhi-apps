/* Where did the printer assignments go? Lists every standing VPO-SHOP-<code> order: its date, status, lines. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, sp] = await Promise.all([get('pt_vendorOrders'), get('pt_shopProd')]);
  Object.entries(vo || {}).forEach(([code, orders]) => Object.entries(orders || {}).forEach(([id, o]) => {
    if (!/^vpo_shop_/.test(id)) return;
    const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
    console.log(code, o.vendorName, o.orderNo, 'date', o.orderDate, 'status', o.status, 'type', o.orderType, 'lines', lines.length,
      'updated', o.staffUpdatedAt, 'by', o.staffUpdatedBy);
  }));
  const recent = Object.values(sp || {}).filter(r => r && r.assignedAt && r.assignedAt > '2026-09-25').map(r => r.printer + ' ' + r.orderNo + ' ' + r.sku);
  console.log('assigned today:', recent.length); console.log(recent.slice(0, 25).join('\n'));
})();
