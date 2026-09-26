/* Where an email is written in the database (read-only). node email-find.js <text> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const want = (process.argv[2] || '').toLowerCase();
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json?shallow=' + (p ? 'false' : 'true'), { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } }); }).on('error', rej));
  const roots = Object.keys(await get('') || {});
  const hits = [];
  const walk = (v, path) => {
    if (v == null) return;
    if (typeof v === 'string') { if (v.toLowerCase().includes(want)) hits.push(path + ' = ' + v); return; }
    if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (k.toLowerCase().includes(want.replace(/\./g, ','))) hits.push(path + '/' + k + '  (KEY)'); walk(x, path + '/' + k); });
  };
  for (const r of roots) { if (/Ledger|baseData|cutting|press|orderBook|shopProd|skuImages|salesOrders|fabInv/i.test(r)) continue; walk(await get(r), r); }
  console.log(hits.join('\n') || 'nothing');
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
