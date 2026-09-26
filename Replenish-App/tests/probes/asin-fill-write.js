/* ONE-OFF FILL of Master Database ASIN / Parent ASIN — the same rules as the app's "ASIN from Amazon" button:
 * ASIN from Amazon's listings report (pt_amzListings), else the Replenishment snapshot; Parent only from the snapshot and only
 * when the snapshot's ASIN is the same one. Blanks only. Writes an undo file of every path it set (all were empty before).
 *   node asin-fill-write.js          → dry run
 *   node asin-fill-write.js --write  → one PATCH */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const RE = /^[A-Z0-9]{10}$/;
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, method, body) => new Promise((res, rej) => { const r = https.request(u, { method: method || 'GET', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, timeout: 120000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else res(JSON.parse(d)); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const val = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null);
  const U = s => String(s == null ? '' : s).trim().toUpperCase();
  const mdb = await req(DB + '/pt_masterDB.json');
  const R = new Map();
  for (const b of ['SP', 'CPC']) {
    const meta = await req(FS + 'repl/' + b); const chunks = val((meta.fields || {}).chunks) || 0;
    for (let i = 0; i < chunks; i++) { const d = await req(FS + 'replrows/' + b + '_' + i); (val(d.fields.r) || []).forEach(r => { const k = U(r.sku); if (!k) return; const e = R.get(k) || {}; if (RE.test(U(r.asin)) && !e.asin) e.asin = U(r.asin); if (RE.test(U(r.parent)) && !e.parent) e.parent = U(r.parent); R.set(k, e); }); }
  }
  const lst = await req(DB + '/pt_amzListings.json');
  const L = new Map(); String((lst && lst.list) || '').split('\n').forEach(l => { const [s, , , a] = l.split('\t'); if (s && RE.test(U(a)) && !L.has(U(s))) L.set(U(s), U(a)); });
  const RP = new Map(); R.forEach(e => { if (e.asin && e.parent && !RP.has(e.asin)) RP.set(e.asin, e.parent); });
  const patch = {}; let nA = 0, nP = 0, fromL = 0;
  Object.entries(mdb).forEach(([key, m]) => {
    if (!m || !m.sku) return;
    const k = U(m.sku), la = L.get(k), ra = (R.get(k) || {}).asin;
    const cur = U(m.asin), curP = U(m.parentAsin);
    const amz = la || ra || '';
    const asin = cur || amz;
    if (!cur && amz) { patch['pt_masterDB/' + key + '/asin'] = amz; nA++; if (amz === la) fromL++; }
    const par = RP.get(asin);
    if (!curP && par) { patch['pt_masterDB/' + key + '/parentAsin'] = par; nP++; }
  });
  console.log({ rows: Object.keys(mdb).length, asin: nA, fromListings: fromL, parent: nP, paths: Object.keys(patch).length });
  if (process.argv[2] !== '--write') return console.log('dry run — nothing written');
  const undo = {}; Object.keys(patch).forEach(p => { undo[p] = null; });
  const f = pathm.join(__dirname, 'asin-fill-undo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(f, JSON.stringify(undo));
  await req(DB + '/.json', 'PATCH', patch);
  console.log('written; undo file', f);
  const back = await req(DB + '/pt_masterDB.json?shallow=false');
  console.log('now with ASIN', Object.values(back).filter(m => m && m.asin).length, 'with parent', Object.values(back).filter(m => m && m.parentAsin).length);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
