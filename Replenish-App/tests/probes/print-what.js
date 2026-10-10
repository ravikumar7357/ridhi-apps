/* What the master data says a SKU is printed as — read-only.
 *   node tests/probes/print-what.js SKU [SKU …]
 * Prints the master row's print/cut/fabric/direction fields, the printing rule for its article + subtype, and the
 * fabric catalogue lines (pt_masters/fabricSku + the built list's inputs) for its colour code. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const skus = process.argv.slice(2).map(s => s.toUpperCase());
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const mdb = Object.values((await get('pt_masterDB.json')) || {}).filter(Boolean);
  const masters = (await get('pt_masters.json')) || {};
  const rules = masters.printRule || {};
  console.log('masters keys:', Object.keys(masters).join(', '));
  for (const sku of skus) {
    const m = mdb.find(r => String(r.sku || '').toUpperCase() === sku);
    console.log('\n=== ' + sku + (m ? '' : ' — NOT IN pt_masterDB'));
    if (!m) continue;
    const keep = Object.fromEntries(Object.entries(m).filter(([k]) => /print|cut|fabric|dir|color|colour|consum|article|subtype|size|brand|width|lay|panel|code|recipe/i.test(k)));
    console.log(JSON.stringify(keep, null, 1));
    const rk = Object.keys(rules).filter(k => k.toLowerCase().includes(String(m.articleType || '').toLowerCase()) || k.toLowerCase().includes(String(m.articleSubtype || m.subtype || '').toLowerCase()));
    rk.forEach(k => console.log('  printRule', k, JSON.stringify(rules[k])));
  }
  const fsk = masters.fabricSku || {};
  const codes = new Set(skus.map(s => (s.match(/^[A-Z]+(\d{1,5})/) || ['', ''])[1]).filter(Boolean));
  console.log('\n=== hand-added fabric SKUs for codes', [...codes].join(','));
  Object.entries(fsk).filter(([k, v]) => [...codes].some(c => JSON.stringify(v).includes(c) || k.includes(c))).forEach(([k, v]) => console.log(' ', k, JSON.stringify(v)));
  console.log('\n=== master rows whose SKU looks like a fabric SKU for those codes');
  mdb.filter(r => [...codes].some(c => new RegExp('^[A-Z]+F?' + c + '-').test(String(r.sku || '').toUpperCase()) && /SF|CF|-CANVAS|-Q-|-T-|-K-/.test(String(r.sku).toUpperCase())))
    .slice(0, 40).forEach(r => console.log(' ', r.sku, '|', r.color, '|', r.fabric, '|', r.articleType, '|', r.articleSubtype || r.subtype, '|', r.printDirection || r.direction || ''));
})().catch(e => { console.error(e.message); process.exit(1); });
