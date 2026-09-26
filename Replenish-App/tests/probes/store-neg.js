/* Every SKU the store reads negative for: printer deliveries vs karigar issues, all time and since the count started. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FROM = '2026-09-22';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, base] = await Promise.all([get('pt_vendorOrders'), get('pt_baseData')]);
  const S = {}; const e = k => S[k] || (S[k] = { dAll: 0, dNow: 0, iAll: 0, iNow: 0, firstDel: '' });
  Object.values(vo || {}).forEach(orders => Object.values(orders || {}).forEach(o => { if (!o || o.orderType === 'running') return;
    (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).forEach(l => { if (!l || !l.sku) return; const k = String(l.sku).toUpperCase();
      (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).forEach(d => { if (!d) return; const q = d.ok ? +d.ok.qty || 0 : +d.qty || 0; const t = String((d.ok && d.ok.at) || d.at || '');
        const x = e(k); x.dAll += q; if (t > FROM) x.dNow += q; if (!x.firstDel || t < x.firstDel) x.firstDel = t; }); }); }));
  Object.values(base || {}).forEach(r => { if (!r || !r.sku) return; const x = e(String(r.sku).toUpperCase()); const q = +r.issuePieces || 0; x.iAll += q; if (String(r.addedAt || '') > FROM) x.iNow += q; });
  const neg = Object.entries(S).filter(([, x]) => x.dNow > 0 && x.dNow - x.iNow < 0).sort((a, b) => (a[1].dNow - a[1].iNow) - (b[1].dNow - b[1].iNow));
  console.log('printer SKUs negative since', FROM + ':', neg.length, '· of', Object.values(S).filter(x => x.dNow > 0).length, 'with a delivery since then');
  console.log('SKU'.padEnd(18), 'in≥22Sep', 'out≥22Sep', 'bal', '| all-time delivered', 'issued', 'diff');
  neg.slice(0, 25).forEach(([k, x]) => console.log(k.padEnd(18), String(x.dNow).padStart(8), String(x.iNow).padStart(9), String(x.dNow - x.iNow).padStart(5), '|', String(x.dAll).padStart(18), String(x.iAll).padStart(6), String(x.dAll - x.iAll).padStart(5)));
  const over = Object.values(S).filter(x => x.dAll > 0 && x.iAll > x.dAll).length;
  console.log('\nSKUs where karigars were ever issued MORE than every printer ever delivered:', over, 'of', Object.values(S).filter(x => x.dAll > 0).length);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
