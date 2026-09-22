/* SKU CODES: load Ravi's 90-row sheet (tests/sku-codes-327.tsv) into pt_masters/skuCode — only if it is empty. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(JSON.parse(d || 'null'))); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const cur = await req('GET', 'pt_masters/skuCode');
  if (cur && Object.keys(cur).length) { console.log('already has', Object.keys(cur).length, '— not touched'); return; }
  const rows = fs.readFileSync(pathm.join(__dirname, '..', 'sku-codes-327.tsv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('\t'));
  const now = new Date().toISOString(), t = Date.now().toString(36), patch = {};
  rows.forEach((r, i) => { patch['skc_' + t + '_' + String(i).padStart(2, '0')] = { article: r[0], subtype: r[1], size: r[2], base: r[3].toUpperCase(), by: 'ravi@thefabricrush.com', at: now, src: 'Ravi sheet 2026-09-22' }; });
  await req('PATCH', 'pt_masters/skuCode', patch);
  const back = await req('GET', 'pt_masters/skuCode');
  console.log('written', Object.keys(back || {}).length);
})().catch(e => { console.error(e.message); process.exit(1); });
