/* What is in the Replenishment snapshot (Firestore repl/<brand> + replrows). Read-only. Prints field
 * names and one row's shape — no values that matter beyond that. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const BASE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(BASE + p, { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  for (const b of ['SP', 'CPC']) {
    const meta = await get('repl/' + b);
    const f = meta.fields || {};
    console.log(b, 'meta keys:', Object.keys(f).join(', '), '| chunks', f.chunks && (f.chunks.integerValue || f.chunks.doubleValue), '| n', f.n && (f.n.integerValue || f.n.doubleValue));
    const c0 = await get('replrows/' + b + '_0');
    const rows = (((c0.fields || {}).r || {}).arrayValue || {}).values || [];
    const keys = new Set(); rows.slice(0, 50).forEach(v => Object.keys((v.mapValue || {}).fields || {}).forEach(k => keys.add(k)));
    console.log(b, 'row fields:', [...keys].sort().join(', '));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
