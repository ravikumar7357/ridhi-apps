/* In the full listings report, which SKUs carry more than one ASIN, and with what status (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const lst = await get(DB + '/pt_amzListings.json');
  const M = new Map(); String(lst.list || '').split('\n').forEach(l => { const [s, st, ch, a] = l.split('\t'); if (!s) return; const k = s.trim().toUpperCase(); (M.get(k) || M.set(k, []).get(k)).push([st, ch, a].join('/')); });
  const multi = [...M].filter(([, v]) => new Set(v.map(x => x.split('/')[2])).size > 1);
  console.log('SKUs', M.size, 'with >1 ASIN', multi.length, 'brands', lst.brands);
  ['RTR25-16106', 'RTR147-16106', 'RTME-014', 'RTR501-16106'].forEach(k => console.log(k, M.get(k)));
  console.log(multi.slice(0, 5));
})().catch(e => { console.error(e.message); process.exit(1); });
