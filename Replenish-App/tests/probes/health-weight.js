/* How heavy the Listing Health snapshot (health/healthrows) is — loadUsSkus reads all of it at sign-in for a Set of SKUs. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => { const t = Date.now(); https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on("end", () => { const j = JSON.parse(d); res({ b: JSON.stringify(j).length, ms: Date.now() - t, j }); }); }).on('error', rej); });
  for (const b of ['SP', 'CPC']) {
    const m = await get(FS + 'health/' + b); const f = m.j.fields || {}; const chunks = +((f.chunks || {}).integerValue || 0);
    let bytes = m.b, ms = m.ms; for (let i = 0; i < chunks; i++) { const c = await get(FS + 'healthrows/' + b + '_' + i); bytes += c.b; ms += c.ms; }
    console.log('health', b, 'chunks', chunks, (bytes / 1048576).toFixed(2), 'MB wire', ms, 'ms');
  }
  const p = await get(FS + 'repl/prodstatus'); console.log('prodstatus', (p.b / 1024).toFixed(0), 'KB');
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
