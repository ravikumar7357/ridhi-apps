/* Where did VND002's "with you" 60X60 pile go? Per open order, oldest first: pieces of that size on
 * the order, pieces asked, and what is left for the pile. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const vo = await get('pt_vendorOrders/VND002');
  const sizes = (process.argv[2] || '60X60,60X90,90,120,110').split(',');
  const orders = Object.values(vo || {}).filter(o => o && ['Received', 'Cancelled'].indexOf(o.status || 'Placed') < 0)
    .sort((a, b) => String(a.orderNo).localeCompare(String(b.orderNo)));
  for (const sz of sizes) {
    console.log('\n== ' + sz + ' ==');
    for (const o of orders) {
      const lines = (o.lines || []).filter(l => l && String(l.size || '').toUpperCase().replace(/\s/g, '') === sz.toUpperCase());
      if (!lines.length) continue;
      const qty = lines.reduce((a, l) => a + (+l.qty || 0), 0);
      const del = lines.reduce((a, l) => a + (l.deliveries ? Object.values(l.deliveries).reduce((x, d) => x + (+d.qty || 0), 0) : 0), 0);
      const skus = new Set(lines.map(l => String(l.sku).toUpperCase()));
      const asked = Object.values(o.rfdReqs || {}).filter(r => r && skus.has(String(r.sku).toUpperCase())).reduce((a, r) => a + (+r.pieces || 0), 0);
      console.log(`  ${o.orderNo}  ${o.status}  type=${o.orderType}  on order ${qty}  delivered back ${del}  asked ${asked}  reqs ${Object.keys(o.rfdReqs || {}).length}`);
    }
  }
})();
