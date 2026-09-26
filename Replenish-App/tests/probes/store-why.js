/* Why a store item reads negative: every printer delivery and every karigar issue of one SKU, dated. node store-why.js RTC508-6060 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const SKU = String(process.argv[2] || 'RTC508-6060').toUpperCase();
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, base, st] = await Promise.all([get('pt_vendorOrders'), get('pt_baseData'), get('pt_storeLedger')]);
  console.log('== printer deliveries of', SKU);
  Object.entries(vo || {}).forEach(([code, orders]) => Object.values(orders || {}).forEach(o => { if (!o) return;
    const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
    lines.forEach(l => { if (!l || String(l.sku || '').toUpperCase() !== SKU) return;
      const dels = Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {});
      console.log('  ', code, o.orderNo || o.id, 'status', o.status, 'line qty', l.qty, '| deliveries:', dels.map(d => (d.date || '?') + ' ' + d.qty + (d.ok ? ' (accepted ' + d.ok.qty + ' at ' + String(d.ok.at).slice(0, 10) + ')' : ' (not accepted)') + ' recorded ' + String(d.at || '').slice(0, 10)).join(' · ') || 'none'); }); }));
  console.log('== karigar issues of', SKU);
  Object.values(base || {}).filter(r => r && String(r.sku || '').toUpperCase() === SKU).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
    .forEach(r => console.log('  ', r.issueDate, 'issued', r.issuePieces, 'to', r.empName, '| order', r.orderNo || '—', '| recorded', String(r.addedAt || '').slice(0, 10)));
  console.log('== typed store rows of', SKU);
  Object.values(st || {}).filter(r => r && String(r.sku || '').toUpperCase() === SKU).forEach(r => console.log('  ', r.kind, r.qty, r.date, r.by));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
