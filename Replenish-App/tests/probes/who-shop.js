/* WHO CAN SEE SHOPIFY ORDERS, in which app — read from the pt_perms mirror. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const perms = await get('pt_perms') || {};
  const rows = Object.entries(perms).map(([k, v]) => ({ who: k.replace(/,/g, '.'), admin: !!(v && v.admin), tabs: Object.keys((v && v.t) || {}) }));
  const withShop = rows.filter(r => r.admin || r.tabs.includes('shop'));
  console.log('accounts', rows.length, '· can open Shopify Orders in the Replenishment app:', withShop.length);
  withShop.forEach(r => console.log('  ', r.who, r.admin ? '(admin)' : '', r.tabs.length + ' tabs'));
  console.log('\naccounts WITHOUT it:');
  rows.filter(r => !r.admin && !r.tabs.includes('shop')).forEach(r => console.log('  ', r.who, '·', r.tabs.join(',') || '(no tabs)'));
})().catch(e => { console.error(e.message); process.exit(1); });
