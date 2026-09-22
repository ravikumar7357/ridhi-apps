/* THE STORE STARTS FRESH (Ravi, 2026-09-22) — the legacy printed/white stock goes, the RFD and greige
 * rows stay. `node store-wipe.js` lists; `node store-wipe.js go` deletes, after writing a full backup. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const KEEP = ['RECEIVE_GREIGE', 'ISSUE_TO_RFD', 'RECEIVE_RFD', 'OPENING_RFD', 'PURCHASE_RFD'];
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 300))); else res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const led = await req('GET', 'pt_fabInvLedger') || {};
  const rows = Object.entries(led);
  const keep = rows.filter(([, v]) => v && KEEP.includes(v.txnType));
  const go = rows.filter(([, v]) => v && !KEEP.includes(v.txnType));
  const byKind = {}; go.forEach(([, v]) => { const k = v.txnType + (v.state ? ' · ' + v.state : ''); byKind[k] = (byKind[k] || 0) + 1; });
  console.log('total', rows.length, 'keeping', keep.length, 'deleting', go.length);
  console.log('to delete:', JSON.stringify(byKind));
  console.log('keeping:', JSON.stringify(keep.reduce((a, [, v]) => (a[v.txnType] = (a[v.txnType] || 0) + 1, a), {})));
  if (process.argv[2] !== 'go') return;
  const file = pathm.join(__dirname, 'fabledger-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(led, null, 1));
  const patch = {}; go.forEach(([k]) => { patch[k] = null; });
  await req('PATCH', 'pt_fabInvLedger', patch);
  const after = await req('GET', 'pt_fabInvLedger') || {};
  const kinds = {}; Object.values(after).filter(Boolean).forEach(v => { kinds[v.txnType] = (kinds[v.txnType] || 0) + 1; });
  console.log('backup', file, '\nleft', Object.keys(after).length, JSON.stringify(kinds));
})().catch(e => { console.error(e.message); process.exit(1); });
