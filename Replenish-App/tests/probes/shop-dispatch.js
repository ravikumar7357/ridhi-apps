/* SHOPIFY DISPATCH, LIVE (Reports → Shopify dispatch, 2026-09-24). Reads both stores' orders for a month and
 * the open ones of the last 120 days through the Price Research backend — the same call the app makes —
 * and runs the report's own functions (sliced from index.html) over them. Prints counts and the carrier
 * names Shopify actually uses. The backend key is read from Firestore config/api and never printed.
 * Usage: node shop-dispatch.js [YYYY-MM] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const APP = pathm.join(__dirname, '../../public/index.html');
const ym = process.argv[2] || new Date().toISOString().slice(0, 7);
const getJson = (url, headers) => new Promise((res, rej) => {
  const go = (u, n) => https.get(u, { headers }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 5) return go(r.headers.location, n + 1);
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('not JSON (HTTP ' + r.statusCode + ')')); } });
  }).on('error', rej);
  go(url, 0);
});
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/config/api',
    { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const pick = k => { const v = f[k]; if (!v) return null; if (v.stringValue) return v.stringValue;
    if (v.mapValue) return v.mapValue.fields; return null; };
  /* The app's PRAPI: config/api holds { url, key } at the top level. */
  const url = pick('url'), key = pick('key');
  if (!url) { console.log('config/api fields:', Object.keys(f).join(', ')); throw new Error('could not find the backend address in config/api'); }

  const html = fs.readFileSync(APP, 'utf8');
  const a = html.indexOf('const REP_SHIP_VIA'), b = html.indexOf('/** Both stores, one window.');
  const lib = new Function('mdbOf', html.slice(a, b) + '\nreturn { repShopDispatch, repShipVia, repShopState };')(() => null);

  const call = async (win, shop) => {
    const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('shopify', 'orders');
    if (shop) u.searchParams.set('shop', shop);
    Object.entries(win).forEach(([k, v]) => u.searchParams.set(k, v));
    const d = await getJson(u.toString(), {});
    if (!d.ok) throw new Error((shop || 'Ridhi') + ': ' + d.error);
    return (d.orders || []).map(o => Object.assign(o, { shopBrand: shop === 'CPC' ? 'CPC' : 'SP' }));
  };
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mon = { start: ym + '-01', end: ym + '-' + String(last).padStart(2, '0'), open: '0' };
  const back = new Date(); back.setDate(back.getDate() - 120);
  const now = { start: back.toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), open: '1' };
  const [m1, m2, n1, n2] = await Promise.all([call(mon), call(mon, 'CPC'), call(now), call(now, 'CPC')]);
  const M = m1.concat(m2), N = n1.concat(n2);
  const cos = {}; M.forEach(o => { if (o.trkCo || o.ff === 'fulfilled') cos[o.trkCo || '(none)'] = (cos[o.trkCo || '(none)'] || 0) + 1; });
  console.log('Carrier names on Shopify fulfilments (' + ym + '):', cos);
  const d = lib.repShopDispatch(M, () => null), n = lib.repShopDispatch(N, () => null);
  console.log('Orders placed ' + ym + ':', JSON.stringify(d.st));
  console.log('Dispatched by:', JSON.stringify(d.via));
  console.log('Pending now (120 days):', JSON.stringify(n.st.pending), '· pieces', n.arts.reduce((t, x) => t + x.pcs, 0));
  console.log('Top pending articles:'); n.arts.slice(0, 12).forEach(x => console.log('  ', String(x.pcs).padStart(4), 'pcs', String(x.orders).padStart(3), 'orders  Ridhi', x.SP, 'CPC', x.CPC, ' oldest', x.oldest, ' ', x.art));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
