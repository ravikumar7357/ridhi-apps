/* WHO RAISED THE RFD REQUIREMENTS, AND HOW? Ravi: VND002 "never asked", yet 190-odd rows are there. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const vo = await get('pt_vendorOrders');
  const groups = {};
  for (const code of Object.keys(vo || {})) for (const oid of Object.keys(vo[code] || {})) {
    const o = vo[code][oid]; const reqs = (o && o.rfdReqs) || {};
    for (const id of Object.keys(reqs)) {
      const r = reqs[id]; if (!r) continue;
      const min = String(r.raisedAt || r.at || '').slice(0, 16);
      const k = [code, o.orderNo || oid, r.raisedBy || r.by || '?', min, r.unit || (r.size ? 'pcs' : 'm'), r.via || r.source || ''].join(' | ');
      groups[k] = (groups[k] || 0) + 1;
    }
  }
  Object.entries(groups).sort().forEach(([k, n]) => console.log(String(n).padStart(4), k));
  // one sample record's field names
  outer: for (const code of Object.keys(vo || {})) for (const oid of Object.keys(vo[code] || {})) {
    const reqs = (vo[code][oid] || {}).rfdReqs; if (reqs) { const id = Object.keys(reqs)[0]; const r = Object.assign({}, reqs[id]); delete r.shown;
      console.log('\nsample fields:', Object.keys(reqs[id]).join(', ')); console.log(JSON.stringify(r).slice(0, 600)); break outer; }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
