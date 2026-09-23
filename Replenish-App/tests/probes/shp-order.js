/* ONE SHOPIFY ORDER, AND WHAT THE ORDER BOOK HAS FOR IT — read-only.
 *
 *   node shp-order.js 6571 [CPC|SP]
 *
 * Ravi, 2026-09-23: a CPC order says "Need from production" on the Shopify screen and no production
 * order opened for it. This prints the order exactly as the backend gives it (per line: fulfilment,
 * fulfillable and current quantity), and every row the order book holds under that number — under
 * any suffix, because a number used by BOTH shops gets one.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const getJson = (url, headers) => new Promise((res, rej) => {
  https.get(url, { headers: headers || {} }, r => {
    if (r.statusCode >= 300 && r.headers.location) return res(getJson(r.headers.location, headers));
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(String(r.statusCode) + ' ' + d.slice(0, 300))); } });
  }).on('error', rej);
});
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const want = String(process.argv[2] || '').replace(/^#/, '');
  if (!want) { console.error('usage: node shp-order.js <order number> [CPC|SP]'); process.exit(1); }
  const onlyShop = (process.argv[3] || '').toUpperCase();
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/config/api`, { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const url = (f.url && f.url.stringValue) || '', key = (f.key && f.key.stringValue) || '';

  const ask = async (shop, from, to) => {
    const u = new URL(url);
    u.searchParams.set('key', key);
    u.searchParams.set('shopify', 'orders');
    if (shop) u.searchParams.set('shop', shop);
    u.searchParams.set('start', from); u.searchParams.set('end', to); u.searchParams.set('open', '0');
    try { const d = await getJson(u.toString()); return d.orders || []; } catch (e) { console.log(shop || 'SP', 'failed:', e.message); return []; }
  };
  /* Widen until it is found: an order that stopped being fetched is exactly the case being chased. */
  const found = [];
  for (const shop of (onlyShop ? [onlyShop === 'SP' ? '' : onlyShop] : ['', 'CPC'])) {
    for (const back of [14, 45, 120]) {
      const os = await ask(shop, day(-back), day(0));
      const hit = os.filter(o => String(o.no || '').replace(/^#/, '') === want);
      if (hit.length) { hit.forEach(o => found.push({ shop: shop || 'SP (Ridhi)', o, window: back })); break; }
    }
  }
  if (!found.length) console.log('order', want, 'was not in any window asked (14, 45, 120 days), either shop');
  found.forEach(({ shop, o, window }) => {
    console.log(`\n=== ${shop} · #${o.no} · placed ${String(o.at).slice(0, 10)} · found within ${window} days`);
    console.log('   fulfilment:', o.ff || '(none)', '· cancelled:', !!o.cancelled, '· ship to:', (o.ship && o.ship.country) || '?');
    (o.items || []).forEach(i => console.log('   line:', i.sku || '(no sku)', '·', String(i.name || '').slice(0, 40),
      '· qty', i.qty, '· ffl', i.ffl || '(none)', '· fulfillable', i.fq, '· current', i.cq));
  });

  const ob = await new Promise((res, rej) => https.get(DB + '/pt_orderBook.json?auth=' + at, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } });
  }).on('error', rej));
  const rows = Object.entries(ob || {})
    .filter(([, r]) => r && (String(r.orderNo || '').indexOf('SHP-' + want) === 0
      || String(r.shopOrderNo || '').replace(/^#/, '') === want));
  console.log('\n=== the order book has', rows.length, 'row(s) for that number');
  rows.forEach(([k, r]) => console.log('  ', k, '·', r.orderNo, '·', r.sku, '· qty', r.qty, '· shopOrderNo', r.shopOrderNo || '—', '· id', r.shopOrderId || '—'));

  /* And whether the number is already owned by the OTHER shop's order, which is what pushes the
   * second one onto a suffixed number. */
  const owners = new Set(rows.map(([, r]) => String(r.shopOrderId || '')));
  if (owners.size > 1) console.log('\n   NOTE: more than one Shopify order id sits under this number:', [...owners].join(', '));
})().catch(e => { console.error(e.message); process.exit(1); });
