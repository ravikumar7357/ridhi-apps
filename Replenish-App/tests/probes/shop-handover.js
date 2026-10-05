/* How Shopify hand-overs to the shipping team are recorded today (4 Oct 2026). Read only. node shop-handover.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [sp, ob] = await Promise.all([get('pt_shopProd'), get('pt_orderBook')]);
  const rows = Object.entries(sp || {}).filter(([, v]) => v && typeof v === 'object');
  const withLog = rows.filter(([, v]) => Array.isArray(v.handLog) && v.handLog.length);
  const full = rows.filter(([, v]) => v.handedAt);
  const logs = withLog.flatMap(([k, v]) => v.handLog.map(h => ({ k, ...h })));
  const byDay = {}; logs.forEach(h => { const d = String(h.at).slice(0, 10); byDay[d] = byDay[d] || { n: 0, pcs: 0 }; byDay[d].n++; byDay[d].pcs += +h.qty || 0; });
  const fullNoLog = full.filter(([, v]) => !(Array.isArray(v.handLog) && v.handLog.length));
  console.log('pt_shopProd rows', rows.length, '| with handLog', withLog.length, '| handed in full', full.length, '| handed in full with no log', fullNoLog.length);
  console.log('handedAt by month', JSON.stringify(full.reduce((m, [, v]) => { const k = String(v.handedAt).slice(0, 7); m[k] = (m[k] || 0) + 1; return m; }, {})));
  console.log('receipts by day', JSON.stringify(byDay));
  console.log('sample row keys', JSON.stringify(rows.slice(0, 2).map(([k, v]) => [k, Object.keys(v)])));
  const shp = Object.values(ob || {}).filter(r => r && /^SHP/i.test(r.orderNo || ''));
  const open = shp.filter(r => !r.shopDoneAt);
  console.log('order book SHP lines', shp.length, '| not shopDone', open.length, '| shopDone by why', JSON.stringify(shp.filter(r => r.shopDoneAt).reduce((m, r) => { m[r.shopDoneWhy] = (m[r.shopDoneWhy] || 0) + 1; return m; }, {})));
})();
