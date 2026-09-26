/* What a B2B order's lines carry, against the master and the custom SKUs (read-only). node b2b-what.js B2B-18092026-04 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const no = (process.argv[2] || 'B2B-18092026-04').toUpperCase();
  const [ob, mdb, cus, so] = await Promise.all(['pt_orderBook', 'pt_masterDB', 'pt_customSkus', 'pt_salesOrders/' + no].map(get));
  const rows = Object.values(ob || {}).filter(r => r && String(r.orderNo).toUpperCase() === no);
  const M = new Map(Object.values(mdb || {}).filter(Boolean).map(r => [String(r.sku).toUpperCase(), r]));
  const Cu = new Map(Object.values(cus || {}).filter(Boolean).map(r => [String(r.sku).toUpperCase(), r]));
  console.log(no, rows.length, 'book lines');
  const f = r => r ? JSON.stringify({ at: r.articleType, st: r.subtype || r.articleSubtype, col: r.color, sz: r.size, item: r.itemName, mat: r.material }) : '-';
  rows.slice(0, 12).forEach(r => { const k = String(r.sku).toUpperCase(); console.log(k.padEnd(18), 'book', f(r), '| master', f(M.get(k)), '| custom', f(Cu.get(k))); });
  const sl = (so && so.lines) || []; console.log('sales order lines', sl.length, JSON.stringify(sl.slice(0, 2)));
  const emptyBook = rows.filter(r => !r.articleType && !r.articleSubtype && !r.color).length;
  console.log('book lines with no article/subtype/colour:', emptyBook, '· of them in master:', rows.filter(r => !r.articleType && M.has(String(r.sku).toUpperCase())).length, '· in custom:', rows.filter(r => !r.articleType && Cu.has(String(r.sku).toUpperCase())).length);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
