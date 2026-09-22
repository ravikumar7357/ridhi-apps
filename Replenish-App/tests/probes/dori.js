/* PIPING DORI: is it in the accessories list already, and what do master rows say about piping? */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const acc = await get('pt_masters/accessories');
  const list = Object.values(acc || {}).filter(Boolean);
  console.log('accessories', list.length, JSON.stringify(list.slice(0, 3)));
  console.log('dori/piping/cord:', JSON.stringify(list.filter(a => /dori|piping|cord/i.test(JSON.stringify(a)))));
  const mdb = Object.values(await get('pt_masterDB') || {}).filter(Boolean);
  const sub = {}; mdb.forEach(m => { if (/piping|pipping/i.test(m.subtype || '')) sub[m.subtype] = (sub[m.subtype] || 0) + 1; });
  console.log('piping subtypes', JSON.stringify(sub));
  const r = {}; mdb.forEach(m => { const k = (m.isRuffle ? 'ruffle' : 'no ruffle'); r[k] = (r[k] || 0) + 1; }); console.log(JSON.stringify(r));
})().catch(e => { console.error(e.message); process.exit(1); });
