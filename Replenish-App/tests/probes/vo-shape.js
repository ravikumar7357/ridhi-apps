/* One recent running and one recent cut vendor order, as stored — read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const all = []; Object.entries((await get('pt_vendorOrders.json')) || {}).forEach(([vc, os]) => Object.values(os || {}).forEach(o => o && all.push(Object.assign({ vc }, o))));
  all.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  for (const type of ['running', 'cut']) {
    const o = all.find(x => x.orderType === type && x.channel); if (!o) continue;
    const c = JSON.parse(JSON.stringify(o)); const ls = Array.isArray(c.lines) ? c.lines : Object.values(c.lines || {}); c.lines = ls.slice(0, 2);
    console.log('=== ' + type + '\n' + JSON.stringify(c, null, 1).slice(0, 2500));
  }
  console.log('channels:', [...new Set(all.map(o => o.channel).filter(Boolean))].join(' | '), ' services:', [...new Set(all.map(o => o.service).filter(Boolean))].join(' | '));
})().catch(e => { console.error(e.message); process.exit(1); });
