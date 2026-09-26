/* How heavy the Replenishment snapshot is for an admin (full repl) vs a team member (replslim). Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => { const t = Date.now(); https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on("end", () => { const j = JSON.parse(d); res({ b: JSON.stringify(j).length, ms: Date.now() - t, j }); }); }).on('error', rej); });
  for (const [meta, rows] of [['repl', 'replrows'], ['replslim', 'replslimrows']]) {
    for (const b of ['SP', 'CPC']) {
      const m = await get(FS + meta + '/' + b); const f = m.j.fields || {}; const chunks = +((f.chunks || {}).integerValue || 0);
      let bytes = 0, ms = 0; for (let i = 0; i < chunks; i++) { const c = await get(FS + rows + '/' + b + '_' + i); bytes += c.b; ms += c.ms; }
      console.log(meta.padEnd(9), b.padEnd(4), 'chunks', chunks, (bytes / 1048576).toFixed(2), 'MB', ms, 'ms', 'at', ((f.at || {}).timestampValue || '').slice(0, 16));
    }
  }
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
