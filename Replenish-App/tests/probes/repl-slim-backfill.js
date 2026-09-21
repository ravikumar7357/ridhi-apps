/* Write the slim copy (replslim/<brand> + replslimrows/<brand>_<i>) from the current full snapshot.
 * Copies only the 8 slim fields, as typed values straight from the source — nothing is re-encoded.
 * Dry run unless --apply. Re-runnable: it overwrites the slim docs, never touches the full ones. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const BASE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const SLIM = ['sku', 'category', 'subcat', 'color', 'size', 'totalStock', 'awdAvail', 'awdTransit'];
const CHUNK = 2500, APPLY = process.argv.includes('--apply');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => {
    const r = https.request(BASE + p, { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { const j = JSON.parse(d || '{}'); if (x.statusCode >= 300) rej(new Error(p + ' ' + x.statusCode + ' ' + d.slice(0, 200))); else res(j); }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  for (const b of ['SP', 'CPC']) {
    const meta = await req('GET', 'repl/' + b);
    const n = +(meta.fields.chunks.integerValue || meta.fields.chunks.doubleValue);
    let rows = [];
    for (let i = 0; i < n; i++) {
      const c = await req('GET', 'replrows/' + b + '_' + i);
      rows = rows.concat((((c.fields || {}).r || {}).arrayValue || {}).values || []);
    }
    const slim = rows.map(v => { const f = (v.mapValue || {}).fields || {}, o = {}; SLIM.forEach(k => { if (f[k]) o[k] = f[k]; }); return { mapValue: { fields: o } }; });
    const chunks = Math.ceil(slim.length / CHUNK) || 1;
    const bytes = JSON.stringify(slim).length;
    console.log(`${b}: ${rows.length} rows → ${chunks} slim chunk(s), ~${Math.round(bytes / 1024)} KB (full chunks ${n})`);
    if (!APPLY) continue;
    for (let i = 0; i < chunks; i++)
      await req('PATCH', 'replslimrows/' + b + '_' + i, { fields: { r: { arrayValue: { values: slim.slice(i * CHUNK, (i + 1) * CHUNK) } } } });
    await req('PATCH', 'replslim/' + b, { fields: { chunks: { integerValue: String(chunks) }, n: { integerValue: String(slim.length) },
      catalogSkus: meta.fields.catalogSkus || { arrayValue: { values: [] } }, at: meta.fields.at || { timestampValue: new Date().toISOString() } } });
    console.log('   written');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
