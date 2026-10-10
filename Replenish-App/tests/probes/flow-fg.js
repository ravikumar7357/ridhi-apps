/* PRODUCTION FLOW — Finished Goods accept/reject log and the ledger rows it wrote. Read-only.
 *   node tests/probes/flow-fg.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const fg = (await get('pt_flowFgSend.json')) || {};
  console.log('== pt_flowFgSend'); Object.entries(fg).forEach(([k, v]) => console.log(' ', k, JSON.stringify(v)));
  const ids = Object.values(fg).map(v => v.fgId).filter(Boolean);
  for (const id of ids) console.log('== ledger', id, JSON.stringify(await get('pt_fgiLedger/' + id + '.json')));
  const test = (await get('pt_flowTest.json')) || {};
  console.log('== test orders fgIn'); Object.entries(test).forEach(([k, v]) => Object.entries(v.lines || {}).forEach(([s, l]) => console.log(' ', k, s, 'qty', l.qty, 'fgIn', l.fgIn || 0)));
})().catch(e => { console.error(e.message); process.exit(1); });
