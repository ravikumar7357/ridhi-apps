/* Size of every top-level node (read-only; downloads the database once, ~11 MB). node node-sizes.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 180000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
  const d = JSON.parse(await get(DB + '/.json'));
  const rows = Object.entries(d).map(([k, v]) => [k, JSON.stringify(v).length]).sort((a, b) => b[1] - a[1]);
  let t = 0; rows.forEach(r => t += r[1]);
  console.log('total', (t / 1048576).toFixed(2), 'MB');
  rows.forEach(([k, b]) => console.log(k.padEnd(26), (b / 1024).toFixed(0).padStart(7), 'KB'));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
