/* Is the Access list really empty? Firestore perms (what Sellora's Access screen lists) vs the RTDB pt_perms mirror. Read only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const get = (u, at) => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } },
  r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res({ status: r.statusCode, body: JSON.parse(d) }); } catch (e) { res({ status: r.statusCode, body: d.slice(0, 300) }); } }); }).on('error', rej));
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const fsr = await get('https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/perms?pageSize=300', at);
  const docs = (fsr.body && fsr.body.documents) || [];
  console.log('Firestore perms: HTTP', fsr.status, '·', docs.length, 'doc(s)');
  docs.slice(0, 50).forEach(d => console.log('  ', d.name.split('/').pop(), 'updated', d.updateTime));
  const mir = await get(DB + '/pt_perms.json?shallow=true', at);
  const keys = Object.keys(mir.body || {});
  console.log('RTDB pt_perms mirror:', keys.length, 'account(s)');
  keys.slice(0, 60).forEach(k => console.log('  ', k));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
