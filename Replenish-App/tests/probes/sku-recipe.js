/* SKU RECIPE: do the master's SKUs follow "base code + colour code"? What does the colour master hold? */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const col = Object.values(await get('pt_masters/colour') || {});
  console.log('colour master', col.length, JSON.stringify(col.slice(0, 3)));
  console.log('with a code that is a number:', col.filter(c => /^\d+$/.test(String(c.code || ''))).length);
  const mdb = Object.values(await get('pt_masterDB') || {}).filter(Boolean);
  console.log('mdb', mdb.length);
  const lsb = mdb.filter(m => /light steel blue/i.test(m.color || ''));
  console.log('Light Steel Blue SKUs', lsb.length, lsb.slice(0, 12).map(m => m.sku + ' ' + m.subtype + ' ' + m.size).join(' | '));
  const has327 = mdb.filter(m => /327/.test(m.sku));
  console.log('SKUs with 327', has327.length, has327.slice(0, 8).map(m => m.sku + ' ' + m.color).join(' | '));
  // colour codes seen in SKUs per colour: e.g. RTC<code>-6060
  const byCol = {};
  mdb.forEach(m => { const x = String(m.sku || '').match(/^RTC(\d+)-6060$/); if (x) byCol[m.color] = x[1]; });
  console.log('RTC<code>-6060 colours', Object.keys(byCol).length, JSON.stringify(Object.entries(byCol).slice(0, 10)));
  const sr = await get('pt_skuRecipe'); console.log('pt_skuRecipe exists?', !!sr);
})().catch(e => { console.error(e.message); process.exit(1); });
