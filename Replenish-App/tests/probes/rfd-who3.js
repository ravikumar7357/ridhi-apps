/* Is every RFD requirement's raiser the login linked to THAT vendor? (Ravi, 21 Sep: none may appear
 * that a vendor did not raise.) Reads the vendor master's email and pin columns. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const root = await get('?shallow=true'.replace('?', '') ) .catch(() => null);
  const keys = Object.keys(await new Promise((res, rej) => https.get(DB + '/.json?shallow=true', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej)));
  const cands = keys.filter(k => /vend|pin/i.test(k));
  console.log('vendor-ish nodes:', cands.join(', '));
  const emails = ['tazeema433@gmail.com', 'ecomridhi2@gmail.com', 'kshoaib355@yahoo.com'];
  for (const k of cands) {
    if (/pt_vendorOrders|pt_rfd/.test(k)) continue;
    const v = await get(k); const txt = JSON.stringify(v || '');
    emails.forEach(e => { const i = txt.toLowerCase().indexOf(e.split('@')[0]); if (i >= 0) console.log(k, '→', txt.slice(Math.max(0, i - 160), i + 60).replace(/"pin[^,]*,/gi, '"pin":"…",')); });
  }
})().catch(e => { console.error(e.message); process.exit(1); });
