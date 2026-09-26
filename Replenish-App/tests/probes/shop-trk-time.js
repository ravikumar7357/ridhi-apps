/* How long the Tracking view's Shopify read takes on live data, and how many book orders it finds (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const getJson = (url, headers) => new Promise((res, rej) => { const go = (u, n) => https.get(u, { headers }, r => {
  if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) return go(r.headers.location, n + 1);
  let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('not JSON ' + r.statusCode)); } }); }).on('error', rej); go(url, 0); });
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const ob = await getJson(DB + '/pt_orderBook.json', { Authorization: 'Bearer ' + at });
  const shp = Object.values(ob || {}).filter(r => r && r.shopOrderId);
  const ids = new Set(shp.map(r => String(r.shopOrderId)));
  const days = shp.map(r => String(r.orderDate || '')).filter(Boolean).sort();
  console.log('book Shopify lines:', shp.length, 'orders:', ids.size, 'dates', days[0], '→', days[days.length - 1]);
  const doc = await getJson('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/config/api', { Authorization: 'Bearer ' + at });
  const f = doc.fields || {}; const url = f.url.stringValue, key = f.key.stringValue;
  const iso = d => { const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/) || String(d).match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/); return m ? (m[1].length === 4 ? m[1] + '-' + m[2] + '-' + m[3] : m[3] + '-' + m[2] + '-' + m[1]) : ''; };
  const start = days.map(iso).filter(Boolean).sort()[0];
  let found = 0, n = 0;
  for (const shop of ['', 'CPC']) {
    const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('shopify', 'orders'); if (shop) u.searchParams.set('shop', shop);
    u.searchParams.set('start', start); u.searchParams.set('end', new Date().toISOString().slice(0, 10)); u.searchParams.set('open', '0');
    const t0 = Date.now(); const d = await getJson(u.toString(), {});
    const os = d.orders || []; n += os.length; found += os.filter(o => ids.has(String(o.id))).length;
    console.log((shop || 'Ridhi') + ': ' + os.length + ' orders in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, more=' + d.more + (d.error ? ' ERR ' + d.error : ''),
      'fulfilled', os.filter(o => o.ff === 'fulfilled').length, 'with tracking', os.filter(o => (o.trk || []).length).length);
  }
  console.log('book orders found in Shopify:', found, 'of', ids.size, '(from', start + ')');
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
