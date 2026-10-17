/* What the fabric SKU master holds, and which colour names the ERP treats as real. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(p + ': ' + d.slice(0, 150))); } }); }).on('error', rej));

  const m = await get('pt_masters');
  console.log('pt_masters keys:', Object.keys(m || {}).join(', '));
  ['fabricSku', 'fabricType', 'colour', 'color', 'colours', 'skuCode'].forEach(k => {
    if (!m || !(k in m)) return;
    const v = m[k];
    const n = Array.isArray(v) ? v.length : Object.keys(v || {}).length;
    console.log('\n== pt_masters/' + k + ' — ' + n + ' entries');
    const sample = Array.isArray(v) ? v.filter(Boolean).slice(0, 4) : Object.entries(v || {}).slice(0, 4).map(([kk, vv]) => ({ _key: kk, ...(typeof vv === 'object' ? vv : { value: vv }) }));
    console.log(JSON.stringify(sample, null, 1).slice(0, 1200));
  });
  fs.writeFileSync(process.env.TEMP + '/pt_masters.json', JSON.stringify(m));
  console.log('\nsaved %TEMP%/pt_masters.json');
})().catch(e => { console.error(e.message); process.exit(1); });
