/* Lines opened from the production bucket, as the database holds them (read-only). node bucket-opened.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const ob = await get(DB + '/pt_orderBook.json');
  const rows = Object.entries(ob || {}).map(([k, v]) => Object.assign({ _key: k }, v));
  const b = rows.filter(r => r.openedFrom === 'bucket');
  const day = {}; b.forEach(r => { const d = String(r.openedAt || '').slice(0, 10); day[d] = (day[d] || 0) + 1; });
  console.log('opened from the bucket, by day:', day);
  const today = b.filter(r => String(r.openedAt || '').slice(0, 10) === (process.env.DAY || '2026-09-28'));
  console.log('today', today.length, 'rows; with shopDoneAt:', today.filter(r => r.shopDoneAt).length);
  const keys = new Set(); today.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  console.log('fields:', [...keys].join(' '));
  console.log('sample:', JSON.stringify(today[0]));
  const nos = [...new Set(today.map(r => r.orderNo))];
  const so = await get(DB + '/pt_salesOrders.json?orderBy=%22$key%22&startAt=%22SHP-%22&endAt=%22SHP-~%22');
  const soKeys = new Set(Object.keys(so || {}));
  console.log('orders', nos.length, '· with a sales order:', nos.filter(n => soKeys.has(n)).length);
  const s1 = so[nos[0]]; console.log('sales order sample', nos[0], JSON.stringify(s1 || null).slice(0, 700));
  const st = {}; nos.forEach(n => { const x = so[n]; const k = x ? (x.status || '(none)') : 'MISSING'; st[k] = (st[k] || 0) + 1; });
  console.log('sales order status:', st);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
