/* Stock on hand for the four CPC lines Ravi is extending, from the Listing Health snapshot.
 * Read-only. node cpc-line-stock.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const req = u => new Promise((res, rej) => {
    https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 300000 }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } });
    }).on('error', rej);
  });
  const dec = v => v == null ? null
    : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
    : 'timestampValue' in v ? v.timestampValue : 'nullValue' in v ? null
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, w]) => [k, dec(w)])) : null;

  const head = await req(FS + 'health/CPC');
  const n = dec(head.fields.chunks) || 0;
  let rows = [];
  for (let i = 0; i < n; i++) {
    const c = await req(FS + 'healthrows/CPC_' + i);
    if (c.fields) rows = rows.concat(dec(c.fields.r) || []);
  }
  console.log('stock read', dec(head.fields.at), '-', rows.length, 'CPC listings');

  const cat = JSON.parse(fs.readFileSync(process.env.TEMP + '/cpc-catalog.json', 'utf8'));
  const sales = JSON.parse(fs.readFileSync(process.env.TEMP + '/cpc-sales.json', 'utf8'));
  const base = new Date(); base.setDate(1);
  const last3 = [];
  for (let i = 1; i <= 3; i++) { const d = new Date(base); d.setMonth(d.getMonth() - i); last3.push(d.toISOString().slice(0, 7)); }
  const rate = sku => { let u = 0; Object.entries(sales[sku] || {}).forEach(([k, v]) => { if (last3.includes(k)) u += v[0]; }); return u / 3; };

  const qty = new Map(rows.map(r => [r.s, r.q]));
  [['CPCFP', 'Embroidery placemat'], ['CPCN', 'Plain napkin'], ['CPCNE', 'Embroidery napkin'], ['CPCRP', 'Reversible placemat']].forEach(([pre, label]) => {
    const re = new RegExp('^' + pre + '[0-9]');
    const skus = Object.keys(cat).filter(s => re.test(s)).sort();
    console.log('');
    console.log('== ' + label + ' (' + pre + ') — stock vs the last 3 months');
    skus.forEach(s => {
      const q = qty.has(s) ? qty.get(s) : null;
      const r = rate(s);
      const cover = r > 0 && q != null ? (q / r).toFixed(1) : (q === 0 ? '0' : '—');
      const flag = q === 0 || q == null ? (r > 0 ? '  <-- OUT OF STOCK and selling' : '  <-- no stock') : (r > 0 && q / r < 2 ? '  <-- under 2 months' : '');
      console.log('   ' + s.padEnd(12) + String(cat[s].color || '').padEnd(20)
        + 'stock ' + String(q == null ? 'n/a' : q).padStart(5)
        + ' | ' + r.toFixed(1).padStart(5) + '/mo | ' + String(cover).padStart(5) + ' months' + flag);
    });
  });
})().catch(e => { console.error(e.message); process.exit(1); });
