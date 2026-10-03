/* How much of the store's traffic already names an order (3 Oct 2026): printer delivery lines (forOrders stamps), cutting
 * entries, karigar issues — by month. node order-coverage.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, open, done, cut] = await Promise.all([get('pt_vendorOrders'), get('pt_baseData'), get('pt_baseDone'), get('pt_cuttingData')]);
  const base = Object.values(open || {}).filter(Boolean);
  Object.entries(done || {}).forEach(([day, m]) => { if (day[0] !== '_') Object.values(m || {}).forEach(r => r && base.push(r)); });
  const mon = s => { s = String(s || ''); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3] + '-' + m[2] : s.slice(0, 7); };
  const tab = {}; const add = (k, m, has, q) => { const t = (tab[k] = tab[k] || {})[m] = tab[k][m] || { n: 0, named: 0, pcs: 0, namedPcs: 0 }; t.n++; t.pcs += q; if (has) { t.named++; t.namedPcs += q; } };
  const ord = s => /^(AMZ|SHP|B2B|SO|ORD|CPC|RID)/i.test(String(s || '').trim()) || String(s || '').trim().length > 3;
  base.forEach(r => add('issue', mon(r.addedAt || r.issueDate), ord(r.orderNo), +r.issuePieces || 0));
  Object.values(cut || {}).forEach(c => c && add('cut', mon(c.addedAt || c.cutDate), ord(c.orderNo), +(c.pieces || c.cutPieces || c.qty) || 0));
  const fields = {};
  Object.values(vo || {}).forEach(orders => Object.values(orders || {}).forEach(o => { if (!o) return;
    (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).forEach(l => { if (!l) return;
      Object.keys(l).forEach(k => fields[k] = (fields[k] || 0) + 1);
      const named = (l.forOrders && Object.keys(l.forOrders).length) || l.shopOrderNo || l.orderNo;
      const dels = Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {});
      dels.forEach(d => d && add('delivery (' + (l.unit === 'm' ? 'm' : 'pcs') + ')', mon(d.date || d.at), named, +(d.ok ? d.ok.qty : d.qty) || 0)); }); }));
  Object.entries(tab).forEach(([k, m]) => { console.log('==', k); Object.entries(m).sort().forEach(([mm, t]) => console.log('  ', mm, `rows ${t.named}/${t.n} name an order · pcs ${t.namedPcs}/${t.pcs}`)); });
  console.log('vendor line fields:', JSON.stringify(fields));
  const sample = base.filter(r => r.orderNo).slice(0, 8).map(r => r.orderNo); console.log('issue orderNo samples', sample.join(' '));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
