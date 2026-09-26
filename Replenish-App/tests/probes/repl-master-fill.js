/* How many Replenishment rows have a blank colour / size / sub-category the Master Database can fill (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 60000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const val = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null);
  const mdb = await get(DB + '/pt_masterDB.json');
  const M = new Map(Object.values(mdb || {}).filter(Boolean).map(m => [String(m.sku).trim().toUpperCase(), m]));
  for (const b of ['SP', 'CPC']) {
    const meta = await get(FS + 'replslim/' + b); const chunks = val(meta.fields.chunks);
    let rows = [];
    for (let i = 0; i < chunks; i++) { const d = await get(FS + 'replslimrows/' + b + '_' + i); rows = rows.concat(val(d.fields.r) || []); }
    const blank = v => !String(v == null ? '' : v).trim();
    const nb = rows.filter(r => blank(r.color) || blank(r.size) || blank(r.subcat));
    const fill = nb.filter(r => { const m = M.get(String(r.sku).trim().toUpperCase()); return m && ((blank(r.color) && m.color) || (blank(r.size) && m.size) || (blank(r.subcat) && (m.subtype || m.articleType))); });
    console.log(b, rows.length, 'rows ·', nb.length, 'with a blank colour/size/sub-category ·', fill.length, 'the master can fill', fill.slice(0, 3).map(r => r.sku).join(' '));
  }
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
