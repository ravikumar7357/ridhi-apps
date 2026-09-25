/* Tree Skirt ruffle: what the SKU rows and the recipes hold (2026-09-25, "har bar ruffle ke fabric me gap"). Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [mdb, rec] = await Promise.all([get('pt_masterDB'), get('pt_masters/recipe')]);
  const L = x => Array.isArray(x) ? x.filter(Boolean) : Object.values(x || {});
  const want = String(process.argv[2] || 'tree skirt').toLowerCase();
  const skus = L(mdb).filter(r => String(r.articleType || '').toLowerCase().includes(want));
  console.log('SKUs:', skus.length);
  const f = ['articleType', 'subtype', 'size', 'isRuffle', 'ruffleMeters', 'ruffleFabric', 'fabric', 'createdAt'];
  const seen = new Set();
  skus.forEach(r => { const k = [r.subtype, r.size].join('|'); if (seen.has(k)) return; seen.add(k); console.log(' SKU', r.sku, JSON.stringify(f.reduce((o, x) => (r[x] !== undefined && (o[x] = r[x]), o), {}))); });
  L(rec).filter(r => String(r.articleType || '').toLowerCase().includes(want)).forEach(r => console.log(' RECIPE', JSON.stringify(r)));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
