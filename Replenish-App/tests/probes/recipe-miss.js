/* Why did the new SKUs not take a recipe? Compare the SKU rows with the recipes for their combination. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const mdb = Object.values(await get('pt_masterDB') || {}).filter(Boolean);
  const want = mdb.filter(m => /^RPC0009-/.test(String(m.sku || '')));
  want.forEach(m => console.log('SKU', JSON.stringify([m.sku, m.articleType, m.subtype, m.size, m.fabric, m.consumption, m.isZip, m.addedAt || ''])));
  const rec = Object.values(await get('pt_masters/recipe') || {}).filter(Boolean);
  console.log('\nrecipes for Piping Flap Pillow Cover:');
  rec.filter(r => /piping flap/i.test(r.subtype || '')).forEach(r => console.log(' ', JSON.stringify([r.articleType, r.subtype, r.size, r.fabric, r.consumption, r.isZip, r.zipQty, r.chainLength])));
  console.log('\nall recipe sizes for article Pillow Cover:', [...new Set(rec.filter(r => /pillow cover/i.test(r.articleType || '')).map(r => r.subtype + ' | ' + r.size))].join('  ·  '));
  console.log('\ntotal recipes', rec.length);
})().catch(e => { console.error(e.message); process.exit(1); });
