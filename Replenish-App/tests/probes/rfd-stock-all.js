const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const st = await get('pt_rfdStock') || {};
  for (const code of Object.keys(st)) {
    const e = Object.entries(st[code] || {});
    console.log(code, e.length, 'entries; with orderId:', e.filter(([, v]) => v && v.orderId).length,
      '; times', [...new Set(e.map(([, v]) => String(v.at || '').slice(0, 16)))].sort().join(', '));
    e.slice(0, 3).forEach(([k, v]) => console.log('   ', k, JSON.stringify(v)));
  }
})();
