/* How much of the Shopify tab's "Send" comes from stock below zero rather than from sales. Read-only.
 * Usage: node shopsku-neg.js [SP|CPC] [target days] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const shop = (process.argv[2] || 'SP').toUpperCase(), target = Number(process.argv[3] || 90);
const getJson = (url, headers) => new Promise((res, rej) => {
  const go = (u, n) => https.get(u, { headers }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) return go(r.headers.location, n + 1);
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('not JSON')); } });
  }).on('error', rej);
  go(url, 0);
});
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/config/api', { Authorization: 'Bearer ' + at });
  const f = doc.fields; const u = new URL(f.url.stringValue); u.searchParams.set('key', f.key.stringValue);
  u.searchParams.set('cache', shop === 'CPC' ? 'shopSkuCPC' : 'shopSku');
  const d = (await getJson(u.toString(), {})).data, st = d.stock || {};
  let oldSend = 0, newSend = 0, negRows = 0, negUnits = 0, negSold = 0; const eg = [];
  Object.entries(d.d).forEach(([sku, [sold]]) => {
    const s = st[sku]; if (s == null) return;
    const rate = sold / d.days; if (!(rate > 0)) return;
    oldSend += Math.max(0, Math.round(rate * target - s));
    newSend += Math.max(0, Math.round(rate * target - Math.max(0, s)));
    if (s < 0) { negRows++; negUnits += -s; negSold += sold; if (sold <= 2) eg.push(`${sku} sold ${sold} stock ${s}`); }
  });
  const allNeg = Object.values(st).filter(v => v < 0);
  console.log(shop, '| SKUs below zero in Shopify:', allNeg.length, '(', allNeg.reduce((a, b) => a - b, 0), 'units ) | of them sold in 90d:', negRows,
    '| their 90d sales', negSold, 'vs below-zero units', negUnits);
  console.log('send at', target, 'days: now', oldSend, '→ negatives not counted as demand', newSend);
  console.log('sold ≤2 but deep below zero, e.g.', eg.slice(0, 10).join(' · '));
})().catch(e => { console.error(e.message); process.exit(1); });
