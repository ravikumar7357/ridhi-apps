/* CPC sales by SKU and month, straight from the Orders workbook through the Pricing-API.
 * Read-only. Writes %TEMP%/cpc-sales.json and %TEMP%/sp-catalog.json.
 *   node cpc-sales.js [bookIndex]        default: walks books 0 and 1
 * Key/url read from Firestore config/api, never printed. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const req = (u, auth) => new Promise((res, rej) => {
    https.get(u, { headers: auth === false ? {} : { Authorization: 'Bearer ' + at }, timeout: 600000 }, x => {
      let d = '';
      x.on('data', c => d += c);
      x.on('end', () => {
        if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(x.headers.location, false).then(res, rej);
        try { res(JSON.parse(d)); } catch (e) { rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); }
      });
    }).on('error', rej);
  });
  const api = await req(FS + 'config/api');
  const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const call = async q => {
    const u = new URL(url);
    u.searchParams.set('key', key);
    Object.entries(q).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await req(u.toString(), false);
    if (!r.ok) throw new Error(r.error || 'backend said no');
    return r;
  };

  const cat = await call({ sales: 'cat', brand: 'SP' });
  fs.writeFileSync(process.env.TEMP + '/cpc-catalog.json', JSON.stringify(cat.map));
  console.log('catalog', cat.n, 'SKUs from', cat.book, '/', cat.tab);

  const books = [];
  const all = {};
  for (const b of books) {
    let start = 2, guard = 0;
    for (;;) {
      let r;
      try { r = await call({ sales: 'chunk', book: b, start, rows: 20000 }); }
      catch (e) { console.log('book', b, 'stopped:', e.message); break; }
      Object.entries(r.d || {}).forEach(([sku, months]) => {
        const m = all[sku] || (all[sku] = {});
        Object.entries(months).forEach(([k, v]) => {
          const t = m[k] || (m[k] = [0, 0]);
          t[0] += v[0]; t[1] += v[1];
        });
      });
      console.log('book', b, 'rows', start, '-', start + r.read - 1, 'of', r.lastRow, '| SKUs so far', Object.keys(all).length);
      if (!r.next || ++guard > 40) break;
      start = r.next;
    }
  }
  fs.writeFileSync(process.env.TEMP + '/cpc-sales.json', JSON.stringify(all));
  console.log('written: SKUs with sales', Object.keys(all).length);
})().catch(e => { console.error(e.message); process.exit(1); });
