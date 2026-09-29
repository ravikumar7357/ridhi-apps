/* Build one store's Shopify per-SKU sales + stock cache NOW (backend ?shopSkuBuild=1&shop=CPC), then read it back.
 * The backend key is read from Firestore config/api and never printed. Usage: node shopsku-build.js [CPC|SP] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const shop = (process.argv[2] || 'CPC').toUpperCase();
const getJson = (url, headers) => new Promise((res, rej) => {
  const go = (u, n) => https.get(u, { headers }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) return go(r.headers.location, n + 1);
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('not JSON (HTTP ' + r.statusCode + ') ' + d.slice(0, 200))); } });
  }).on('error', rej);
  go(url, 0);
});
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/config/api', { Authorization: 'Bearer ' + at });
  const f = doc.fields || {}; const url = f.url.stringValue, key = f.key.stringValue;
  const q = o => { const u = new URL(url); u.searchParams.set('key', key); Object.entries(o).forEach(([k, v]) => u.searchParams.set(k, v)); return u.toString(); };
  const t0 = Date.now();
  console.log('build', JSON.stringify(await getJson(q({ shopSkuBuild: 1, shop }), {})), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  const c = await getJson(q({ cache: shop === 'CPC' ? 'shopSkuCPC' : 'shopSku' }), {});
  if (!c.ok) return console.log('cache:', c.error);
  const d = c.data, st = d.stock || {};
  const skus = Object.keys(d.d || {});
  console.log('at', d.at, '| orders', d.orders, '| sold SKUs', skus.length, '| stock SKUs', Object.keys(st).length, '| stockAt', d.stockAt);
  console.log('top sellers', skus.sort((a, b) => d.d[b][0] - d.d[a][0]).slice(0, 8).map(k => `${k} sold ${d.d[k][0]} stock ${st[k]}`).join(' · '));
})().catch(e => { console.error(e.message); process.exit(1); });
