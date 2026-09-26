/* Which fields make a FULL Replenishment row heavy (plain JSON, as the browser holds it). Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const val = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null);
  const meta = await get(FS + 'repl/SP'); const chunks = val(meta.fields.chunks);
  console.log('meta fields:', Object.keys(meta.fields).join(', '), '| recCols', (val(meta.fields.recCols) || []).length);
  let rows = []; for (let i = 0; i < chunks; i++) { const d = await get(FS + 'replrows/SP_' + i); rows = rows.concat(val(d.fields.r) || []); }
  const plain = JSON.stringify(rows); console.log('SP rows', rows.length, 'plain JSON', (plain.length / 1048576).toFixed(2), 'MB', Math.round(plain.length / rows.length), 'bytes/row');
  const F = {}; rows.forEach(r => Object.entries(r).forEach(([k, v]) => { const f = F[k] || (F[k] = { n: 0, b: 0, max: 0 }); f.n++; const b = JSON.stringify(v).length + k.length + 3; f.b += b; if (b > f.max) f.max = b; }));
  console.log("fields", Object.keys(F).length, Object.keys(F).sort().join(" "));
  Object.entries(F).sort((a, b) => b[1].b - a[1].b).slice(0, 30).forEach(([k, f]) => console.log(k.padEnd(22), String(f.n).padStart(6), (f.b / 1024).toFixed(0).padStart(7) + ' KB', 'max', f.max, (rows.find(r => r[k] != null) ? typeof rows.find(r => r[k] != null)[k] : '')));
  const r0 = rows[0]; console.log("rec sample", JSON.stringify(r0.rec).slice(0, 200)); console.log("inflow sample", JSON.stringify(r0.inflow).slice(0, 200));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
