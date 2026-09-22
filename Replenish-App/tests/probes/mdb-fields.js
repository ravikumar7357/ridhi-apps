/* Which fields do live master rows carry? The import rewrites a row from its template columns only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const mdb = await get('pt_masterDB');
  fs.writeFileSync(process.argv[2] + '/mdb-full.json', JSON.stringify(mdb));
  const c = {}; Object.values(mdb).filter(Boolean).forEach(r => Object.keys(r).forEach(k => { c[k] = (c[k] || 0) + 1; }));
  console.log(JSON.stringify(c));
})().catch(e => { console.error(e.message); process.exit(1); });
