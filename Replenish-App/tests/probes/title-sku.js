/* WOULD THE TITLE MATCHER FIND IT — against the live shop and the live master. Read-only.
 *
 *   node title-sku.js [days]
 *
 * Runs the app's OWN shpSkuFromTitle, cut out of public/index.html, over every line the two shops
 * have sent in the window that carries no SKU. Prints what it would open and what it still cannot,
 * so the blast radius is known before anybody presses Fetch.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const APP = pathm.join(__dirname, '..', '..', 'public', 'index.html');
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const get = (u, h) => new Promise((res, rej) => https.get(u, { headers: h || {} }, r => {
  if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, h));
  let d = ''; r.on('data', c => d += c);
  r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(r.statusCode + ' ' + d.slice(0, 200))); } });
}).on('error', rej));
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/* The app's own matcher, not a copy of it. */
function matcherFromApp() {
  const src = fs.readFileSync(APP, 'utf8');
  const a = src.indexOf('const shpWords = v =>');
  const b = src.indexOf('function shpNeeds(', a);
  if (a < 0 || b < 0) throw new Error('the matcher is not where it was — has it been renamed?');
  const block = src.slice(a, b);
  return new Function('PTG', block + '\n;return { shpWords, shpSkuFromTitle };');
}

(async () => {
  const back = Number(process.argv[2] || 45);
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await get('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/config/api', { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const mdbRaw = await get(DB + '/pt_masterDB.json', { Authorization: 'Bearer ' + at });
  const mdb = Object.values(mdbRaw || {}).filter(Boolean);
  const PTG = { mdb };
  const M = matcherFromApp()(PTG);
  console.log('master rows:', mdb.length);

  const ask = async shop => {
    const u = new URL(f.url.stringValue);
    u.searchParams.set('key', f.key.stringValue);
    u.searchParams.set('shopify', 'orders');
    if (shop) u.searchParams.set('shop', shop);
    u.searchParams.set('start', day(-back)); u.searchParams.set('end', day(0)); u.searchParams.set('open', '0');
    try { return (await get(u.toString())).orders || []; } catch (e) { console.log(shop || 'Ridhi', 'failed:', e.message); return []; }
  };
  const found = [], lost = [];
  for (const shop of ['', 'CPC']) {
    const orders = await ask(shop);
    console.log((shop || 'Ridhi (default)') + ':', orders.length, 'order(s) in the last', back, 'days');
    orders.forEach(o => (o.items || []).forEach(i => {
      if (String((i && i.sku) || '').trim()) return;
      if (!(Number(i.cq) > 0)) return;                       // nobody is waiting for it
      const m = M.shpSkuFromTitle(i.name, i.variant);
      const line = { shop: shop || 'Ridhi', no: o.no, name: i.name, variant: i.variant || '', qty: i.qty };
      if (m) found.push(Object.assign(line, { sku: m.sku, sub: m.subtype, col: m.color, size: m.size }));
      else lost.push(line);
    }));
  }
  console.log('\n=== codeless lines the title now FINDS:', found.length);
  found.forEach(x => console.log('  ', x.shop, x.no, '·', x.name, x.variant ? '· ' + x.variant : '',
    '\n        →', x.sku, '|', x.sub, '|', x.col, '|', x.size));
  console.log('\n=== still cannot be matched (the variant needs a SKU in Shopify):', lost.length);
  lost.forEach(x => console.log('  ', x.shop, x.no, '·', x.name, x.variant ? '· ' + x.variant : ''));
})().catch(e => { console.error(e.message); process.exit(1); });
