/* Where a store item's pieces came from and went (3 Oct 2026): printer deliveries, cutting entries, karigar issues (open AND
 * completed section), dated. node store-why2.js RCNB351-8 [RCNB354-48 …] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const SKUS = process.argv.slice(2).map(s => s.toUpperCase());
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, open, done, cut, st] = await Promise.all([get('pt_vendorOrders'), get('pt_baseData'), get('pt_baseDone'), get('pt_cuttingData'), get('pt_storeLedger')]);
  const base = Object.values(open || {});
  Object.entries(done || {}).forEach(([day, m]) => { if (day[0] !== '_') Object.values(m || {}).forEach(r => base.push(r)); });
  for (const SKU of SKUS) {
    console.log('\n######', SKU);
    let dTot = 0;
    Object.entries(vo || {}).forEach(([code, orders]) => Object.values(orders || {}).forEach(o => { if (!o) return;
      const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
      lines.forEach(l => { if (!l || String(l.sku || '').toUpperCase() !== SKU) return;
        const dels = Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {});
        dels.forEach(d => dTot += +(d.ok ? d.ok.qty : d.qty) || 0);
        console.log('  PRINTER', code, o.orderNo || o.id, o.status, 'ordered', l.qty, 'placed', String(o.createdAt || o.orderDate || '').slice(0, 10), '| delivered:', dels.map(d => (d.date || String(d.at || '').slice(0, 10)) + ' ' + d.qty + (d.ok ? ' (ok ' + d.ok.qty + ')' : '')).join(' · ') || 'none'); }); }));
    const cuts = Object.values(cut || {}).filter(c => c && String(c.sku || '').toUpperCase() === SKU);
    cuts.forEach(c => console.log('  CUT', c.cutDate, c.pieces || c.cutPieces || c.qty, 'pcs', '| fabric', c.fabricWidth || '', c.color || '', '| order', c.orderNo || '—', '| by', c.addedBy || ''));
    const iss = base.filter(r => r && String(r.sku || '').toUpperCase() === SKU).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
    let iTot = 0;
    iss.forEach(r => { iTot += +r.issuePieces || 0; console.log('  ISSUE', r.issueDate, r.issuePieces, '→', r.empName, '| op', r.operation || r.workType || r.articleType || '', '| order', r.orderNo || '—', '| recv', r.receivedPieces, '| rec', String(r.addedAt || '').slice(0, 10)); });
    console.log('  TOTAL printer delivered', dTot, '| cut entries', cuts.length, '| issued', iTot, 'in', iss.length, 'rows');
    Object.values(st || {}).filter(r => r && String(r.sku || '').toUpperCase() === SKU).forEach(r => console.log('  TYPED', r.kind, r.qty, r.date, r.by));
  }
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
