/* After the recipe fallback: for every ruffle SKU, where its metres now come from (sku / recipe / rule / none). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const key = m => [norm(m.articleType), norm(m.subtype), norm(m.size)].join('|');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [mdbRaw, recs, rules] = await Promise.all([get('pt_masterDB'), get('pt_masters/recipe'), get('pt_masters/ruffleRule')]);
  const R = new Map(Object.values(recs || {}).filter(Boolean).map(r => [key(r), r]));
  const rk = (s, z) => String(s || '').trim().toLowerCase() + '|' + String(z || '').trim().toLowerCase().replace(/\s+/g, '');
  const RL = Object.values(rules || {}).filter(Boolean);
  const isR = m => m.isRuffle === true || m.isRuffle === 'yes' || /ruffle/i.test(String(m.subtype || ''));
  const out = {}, none = {};
  Object.values(mdbRaw || {}).filter(m => m && isR(m)).forEach(m => {
    const oF = String(m.ruffleFabric || '').trim(), oM = parseFloat(m.ruffleMeters);
    let from = 'none';
    if (oF && oM > 0) from = 'sku';
    else { const r = R.get(key(m)); const rm = oM > 0 ? oM : parseFloat(r && r.ruffleMeters), rf = oF || String(r && r.ruffleFabric || '').trim();
      if (r && norm(r.isRuffle) !== 'no' && rf && rm > 0) from = 'recipe';
      else { const x = RL.find(x => rk(x.subtype, x.size) === rk(m.subtype, m.size)); if (x && String(x.fabric || '').trim() && parseFloat(x.meters) > 0) from = 'rule'; } }
    out[from] = (out[from] || 0) + 1;
    if (from === 'none') { const k = m.articleType + ' | ' + m.subtype + ' | ' + m.size; none[k] = (none[k] || 0) + 1; }
  });
  console.log('ruffle SKUs by where metres come from:', out, '| ruffle rules:', RL.length);
  Object.entries(none).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(String(n).padStart(4), k));
})().catch(e => { console.error(e.message); process.exit(1); });
