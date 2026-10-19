/* Both brand catalogues (SKU -> colour/size/subcat), each to its own file. Read-only.
 * Writes %TEMP%/cat-CPC.json and %TEMP%/cat-SP.json. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const req = (u, auth) => new Promise((res, rej) => {
    https.get(u, { headers: auth === false ? {} : { Authorization: 'Bearer ' + at }, timeout: 600000 }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => {
        if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(x.headers.location, false).then(res, rej);
        try { res(JSON.parse(d)); } catch (e) { rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); }
      });
    }).on('error', rej);
  });
  const api = await req(FS + 'config/api');
  const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  for (const brand of ['CPC', 'SP']) {
    const u = new URL(url);
    u.searchParams.set('key', key);
    u.searchParams.set('sales', 'cat');
    u.searchParams.set('brand', brand);
    const r = await req(u.toString(), false);
    if (!r.ok) throw new Error(brand + ': ' + r.error);
    const out = process.env.TEMP + '/cat-' + brand + '.json';
    fs.writeFileSync(out, JSON.stringify(r.map));
    console.log(brand, r.n, 'SKUs from', r.book, '/', r.tab, '->', out);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
