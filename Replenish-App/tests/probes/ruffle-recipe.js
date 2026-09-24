/* WHY IS RUFFLE "?m" ON THE MASTER? (Ravi, 2026-09-24: "receipi me ek bar detail fill kar diya to abhi
 * isme ruffle consumption kyo nahi aa rha h".) For every SKU with ruffle Yes: does it carry metres,
 * does its recipe (article|subtype|size) exist, and does the recipe say metres / ruffle fabric. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const key = m => [norm(m.articleType), norm(m.subtype), norm(m.size)].join('|');
const said = v => v !== undefined && v !== null && String(v).trim() !== '';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const [mdbRaw, recs] = await Promise.all([get('pt_masterDB'), get('pt_masters/recipe')]);
  const mdb = Object.values(mdbRaw || {}).filter(Boolean);
  const R = new Map(Object.values(recs || {}).filter(Boolean).map(r => [key(r), r]));
  const ruf = mdb.filter(m => m.isRuffle === true);
  const noM = ruf.filter(m => !(parseFloat(m.ruffleMeters) > 0));
  console.log('SKUs ruffle Yes:', ruf.length, '| without metres:', noM.length);
  const g = {};
  noM.forEach(m => {
    const r = R.get(key(m));
    const why = !r ? 'NO RECIPE for this article|subtype|size'
      : !said(r.ruffleMeters) ? 'recipe exists, ruffle metres BLANK in recipe'
      : 'recipe HAS ' + r.ruffleMeters + 'm' + (r.ruffleFabric ? ' ' + r.ruffleFabric : '') + ' — not applied to SKU';
    const k = norm(m.subtype) + ' | ' + why;
    (g[k] = g[k] || []).push(m.sku + ' ' + m.size);
  });
  Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => console.log(String(v.length).padStart(4), k, '  e.g.', v.slice(0, 3).join(', ')));
  console.log('\nRecipes that mention ruffle:');
  Object.values(recs || {}).filter(r => r && (said(r.ruffleMeters) || r.isRuffle === 'yes')).slice(0, 60)
    .forEach(r => console.log('  ', key(r).padEnd(60), 'isRuffle', r.isRuffle || '-', '| m', r.ruffleMeters || '-', '| fab', r.ruffleFabric || '-', '|', r.editedBy || r.seededBy || '', r.editedAt || r.seededAt || ''));
  const cp = mdb.filter(m => /^CPCRU014-/.test(m.sku));
  console.log('\nCPCRU014 rows:'); cp.forEach(m => console.log('  ', m.sku, '|', m.articleType, '|', m.subtype, '|', m.size, '| m', m.ruffleMeters, '| recipe key', key(m), R.has(key(m)) ? 'FOUND' : 'none'));
})().catch(e => { console.error(e.message); process.exit(1); });
