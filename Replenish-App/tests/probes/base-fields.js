/* JOB WORK DATES: which date fields do register rows carry, and how often? */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const rows = Object.values(await get('pt_baseData') || {}).filter(Boolean);
  const c = {}; rows.forEach(r => Object.keys(r).forEach(k => { c[k] = (c[k] || 0) + 1; }));
  console.log(rows.length, JSON.stringify(c));
  const rec = rows.filter(r => Number(r.receivedPieces) > 0);
  console.log('received >0', rec.length, 'with receivingDate', rec.filter(r => r.receivingDate).length, 'frozen', rec.filter(r => r.frozen).length);
  const s = rec.find(r => r.recvLog || r.receipts || r.recv); console.log(JSON.stringify(s || rec[0]).slice(0, 700));
})().catch(e => { console.error(e.message); process.exit(1); });
