/* RBP → Ridhi on the master (Ravi, 2026-09-22: "rbp ridhi hi brand h"). Backs up every brand first;
 * `node brand-rbp-ridhi.js rollback <backup.json>` puts them back. Only rows whose brand is exactly RBP change. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  if (process.argv[2] === 'rollback') {
    const b = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const patch = {}; Object.entries(b).forEach(([k, v]) => { patch[k + '/brand'] = v; });
    await req('PATCH', 'pt_masterDB', patch); console.log('rolled back', Object.keys(patch).length); return;
  }
  const mdb = await req('GET', 'pt_masterDB');
  const backup = {}; Object.entries(mdb).forEach(([k, v]) => { if (v) backup[k] = v.brand == null ? null : v.brand; });
  const file = pathm.join(__dirname, 'brand-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(backup));
  const patch = {}; Object.entries(mdb).forEach(([k, v]) => { if (v && String(v.brand) === 'RBP') patch[k + '/brand'] = 'Ridhi'; });
  console.log('backup', file, 'rows to change', Object.keys(patch).length);
  if (process.argv[2] !== 'go') return;
  await req('PATCH', 'pt_masterDB', patch);
  const after = await req('GET', 'pt_masterDB');
  const c = {}; Object.values(after).filter(Boolean).forEach(v => { c[String(v.brand)] = (c[String(v.brand)] || 0) + 1; });
  console.log('brands now', JSON.stringify(c));
})().catch(e => { console.error(e.message); process.exit(1); });
