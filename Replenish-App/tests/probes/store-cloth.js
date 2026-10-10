/* What the store holds as cloth for a fabric + colour, row by row — read-only.  node tests/probes/store-cloth.js "Cambric" "Light Steel Blue" */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const [fab, col] = process.argv.slice(2).map(x => String(x || '').trim().toUpperCase());
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const st = Object.values((await get('pt_storeLedger.json')) || {}).filter(Boolean);
  const hit = st.filter(r => String(r.fabric || r.fabricType || '').toUpperCase().includes(fab) && (!col || String(r.colour || r.color || '').toUpperCase().includes(col)));
  console.log('pt_storeLedger rows:', st.length, 'matching', hit.length);
  hit.forEach(r => console.log(' ', JSON.stringify(r).slice(0, 400)));
  const vo = Object.entries((await get('pt_vendorOrders.json')) || {});
  let n = 0;
  vo.forEach(([vc, orders]) => Object.values(orders || {}).forEach(o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).forEach(l => {
    if (!l) return; const f = String(l.fabricType || l.fabric || '').toUpperCase(), c = String(l.colour || l.color || '').toUpperCase();
    if (f.includes(fab) && (!col || c.includes(col)) && n++ < 15) console.log('  VO', vc, o.orderNo || o.id, o.orderType, f, c, 'meters', l.meters, 'deliveries', JSON.stringify(l.deliveries || []).slice(0, 200));
  })));
  console.log('vendor-order lines matching:', n);
})().catch(e => { console.error(e.message); process.exit(1); });
