/* MASTER CLEAN-UP: dump the live master (SKU, brand, article, subtype, colour, size) and the colour master to a scratch folder. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const [mdb, masters] = await Promise.all([get('pt_masterDB'), get('pt_masters')]);
  const out = process.argv[2];
  fs.writeFileSync(out + '/mdb.json', JSON.stringify(Object.entries(mdb || {}).filter(([, v]) => v).map(([k, v]) => ({ _key: k, sku: v.sku, brand: v.brand, articleType: v.articleType, subtype: v.subtype, color: v.color, size: v.size, isCustom: v.isCustom }))));
  fs.writeFileSync(out + '/masters.json', JSON.stringify({ colour: masters.colour, size: masters.size, articleType: masters.articleType, articleSubtype: masters.articleSubtype }));
  console.log('rows', Object.keys(mdb || {}).length);
})().catch(e => { console.error(e.message); process.exit(1); });
