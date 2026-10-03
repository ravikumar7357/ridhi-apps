/* Where Job Work issues with no order number come from (3 Oct 2026). node noorder-issues.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [open, done] = await Promise.all([get('pt_baseData'), get('pt_baseDone')]);
  const base = Object.values(open || {}).filter(Boolean);
  Object.entries(done || {}).forEach(([day, m]) => { if (day[0] !== '_') Object.values(m || {}).forEach(r => r && base.push(r)); });
  const no = base.filter(r => !String(r.orderNo || '').trim());
  const last = no.map(r => String(r.addedAt || '')).sort().pop();
  console.log('no-order issues', no.length, 'pcs', no.reduce((a, r) => a + (+r.issuePieces || 0), 0), '| newest', last);
  const keys = {}; no.slice(0, 400).forEach(r => Object.keys(r).forEach(k => keys[k] = (keys[k] || 0) + 1)); console.log('fields', JSON.stringify(keys));
  const by = (f) => { const m = {}; no.forEach(r => { const k = f(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10); };
  console.log('by month', JSON.stringify(by(r => String(r.addedAt || '').slice(0, 7))));
  console.log('by addedBy', JSON.stringify(by(r => r.addedBy || '?')));
  console.log('by src/custom', JSON.stringify(by(r => [r.src || '', r.custom ? 'custom' : '', r.legacy ? 'legacy' : '', r.importedFrom || '', r.via || ''].join('|'))));
  console.log('newest 5', JSON.stringify(no.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt))).slice(0, 5).map(r => [r.addedAt, r.sku, r.issuePieces, r.empName, r.addedBy, r.custom])));
})();
