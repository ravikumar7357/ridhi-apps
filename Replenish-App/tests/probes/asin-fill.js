/* How many Master Database SKUs have no ASIN / Parent ASIN, and how many Amazon's own data can fill (read-only).
 * Sources: the Replenishment snapshot (Firestore repl/<brand> + replrows — asin and parent per SKU, from Amazon's
 * reports) and pt_amzListings (the full listings report — asin only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 90000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const val = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null);
  const U = s => String(s == null ? '' : s).trim().toUpperCase();
  const mdb = await get(DB + '/pt_masterDB.json');
  const rows = Object.entries(mdb || {}).filter(([, m]) => m && m.sku);
  const fields = new Set(); rows.forEach(([, m]) => Object.keys(m).forEach(k => fields.add(k)));
  console.log('master rows', rows.length, '| asin-ish fields:', [...fields].filter(k => /asin|parent/i.test(k)).join(',') || 'none');
  const R = new Map();
  for (const b of ['SP', 'CPC']) {
    const meta = await get(FS + 'repl/' + b); const chunks = val((meta.fields || {}).chunks) || 0;
    let n = 0;
    for (let i = 0; i < chunks; i++) { const d = await get(FS + 'replrows/' + b + '_' + i); (val(d.fields.r) || []).forEach(r => { n++; const k = U(r.sku); if (!k) return; const e = R.get(k) || {}; if (r.asin && !e.asin) e.asin = r.asin; if (r.parent && !e.parent) e.parent = r.parent; R.set(k, e); }); }
    console.log('repl', b, n, 'rows; updated', meta.fields && val(meta.fields.at || meta.fields.updated));
  }
  const lst = await get(DB + '/pt_amzListings.json?shallow=false');
  const L = new Map(); String((lst && lst.list) || '').split('\n').forEach(l => { const [s, , , a] = l.split('\t'); if (s && a && !L.has(U(s))) L.set(U(s), a.trim()); });
  console.log('listings', L.size, 'SKUs with an ASIN; built', lst && lst.at);
  let noA = 0, noP = 0, fA = 0, fAL = 0, fP = 0, none = 0, clash = 0; const miss = [];
  rows.forEach(([, m]) => {
    const k = U(m.sku), r = R.get(k) || {}, la = L.get(k);
    const a = String(m.asin || '').trim(), p = String(m.parentAsin || '').trim();
    if (!a) { noA++; if (r.asin) fA++; else if (la) fAL++; else { none++; if (miss.length < 8) miss.push(m.sku); } }
    if (!p) { noP++; if (r.parent) fP++; }
    if (r.asin && la && r.asin !== la) clash++;
  });
  console.log({ noAsin: noA, fromRepl: fA, fromListingsOnly: fAL, nowhere: none, noParent: noP, parentFromRepl: fP, replVsListingsDiffer: clash });
  const cl = rows.filter(([, m]) => { const k = U(m.sku), r = R.get(k) || {}, la = L.get(k); return r.asin && la && r.asin !== la; }).slice(0, 6).map(([, m]) => m.sku + " repl=" + R.get(U(m.sku)).asin + " lst=" + L.get(U(m.sku)) + " par=" + R.get(U(m.sku)).parent);
  console.log("clash e.g.", cl);
  const np = rows.filter(([, m]) => { const r = R.get(U(m.sku)) || {}; return r.asin && !r.parent; }).slice(0, 8).map(([, m]) => m.sku + ":" + R.get(U(m.sku)).asin);
  console.log("asin but no parent e.g.", np.join(" "));
  const selfp = [...R.values()].filter(e => e.parent && e.parent === e.asin).length; console.log("parent==asin", selfp);
  console.log('nowhere e.g.', miss.join(' '));
  const withParent = [...R.values()].filter(e => e.parent).length;
  console.log('repl SKUs', R.size, 'with parent', withParent);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
