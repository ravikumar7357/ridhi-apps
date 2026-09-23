/* DOES THE CPC STORE ACTUALLY ANSWER TODAY — read-only.
 *
 *   node cpc-live.js [from] [to]
 *
 * The Replenishment app asks the Price Research backend for both shops at once: the Ridhi store
 * (no `shop`) and CPC (`shop=CPC`). If CPC comes back empty or with an error while Ridhi answers,
 * the problem is the backend's CPC connection, not anybody's permissions.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const getJson = (url, headers) => new Promise((res, rej) => {
  https.get(url, { headers: headers || {} }, r => {
    if (r.statusCode >= 300 && r.headers.location) return res(getJson(r.headers.location, headers));
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(String(r.statusCode) + ' ' + d.slice(0, 300))); } });
  }).on('error', rej);
});
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
(async () => {
  const from = process.argv[2] || day(-7), to = process.argv[3] || day(0);
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/config/api`, { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const url = (f.url && f.url.stringValue) || '', key = (f.key && f.key.stringValue) || '';
  if (!url) { console.error('no backend url in config/api'); process.exit(1); }
  const ask = async shop => {
    const u = new URL(url);
    u.searchParams.set('key', key);
    u.searchParams.set('shopify', 'orders');
    if (shop) u.searchParams.set('shop', shop);
    u.searchParams.set('start', from); u.searchParams.set('end', to); u.searchParams.set('open', '0');
    const t0 = Date.now();
    try { const d = await getJson(u.toString()); return { d, ms: Date.now() - t0 }; }
    catch (e) { return { d: { ok: false, error: e.message }, ms: Date.now() - t0 }; }
  };
  for (const shop of ['', 'CPC']) {
    const { d, ms } = await ask(shop);
    const name = shop || 'Ridhi (the default store)';
    if (!d.ok) { console.log(name, '→ FAILED:', d.error); continue; }
    const os = d.orders || [];
    console.log(`${name} → ${os.length} order(s) between ${from} and ${to} · ${ms} ms`
      + (d.more ? ' · more than one page' : ''));
    os.slice(0, 5).forEach(o => console.log('   ', o.no, o.at && String(o.at).slice(0, 10),
      (o.items || []).length + ' line(s)', o.ff || '(not shipped)', o.ship && o.ship.country || ''));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
