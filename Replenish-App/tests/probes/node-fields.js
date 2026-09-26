/* Which FIELDS carry the bytes in a node (read-only). node node-fields.js pt_masterDB */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const node = process.argv[2] || 'pt_masterDB';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
  const raw = await get(DB + '/' + node + '.json'); const d = JSON.parse(raw);
  const rows = Object.values(d || {}).filter(x => x && typeof x === 'object');
  console.log(node, (raw.length / 1048576).toFixed(2), 'MB', rows.length, 'rows', Math.round(raw.length / rows.length), 'bytes/row');
  const F = {}; rows.forEach(r => Object.entries(r).forEach(([k, v]) => { const f = F[k] || (F[k] = { n: 0, b: 0, max: 0 }); f.n++; const b = JSON.stringify(v).length + k.length + 3; f.b += b; if (b > f.max) f.max = b; }));
  Object.entries(F).sort((a, b) => b[1].b - a[1].b).slice(0, 25).forEach(([k, f]) => console.log(k.padEnd(28), String(f.n).padStart(6), (f.b / 1024).toFixed(0).padStart(7) + ' KB', 'max', f.max));
  const big = rows.map(r => [JSON.stringify(r).length, r.sku || r.orderNo || r.id || '']).sort((a, b) => b[0] - a[0]).slice(0, 5);
  console.log('biggest rows', big);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
