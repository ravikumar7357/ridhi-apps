const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const m = await get('pt_masters/fabricType');
  const names = Object.values(m || {}).map(x => (x && (x.desc || x.code)) || "");
  console.log(names.length, JSON.stringify(Object.values(m || {}).slice(0, 3)).slice(0, 300)); console.log(names.filter(n => /voil|canvas|voile/i.test(JSON.stringify(n))).join(" | ") || "(none)");
})();
