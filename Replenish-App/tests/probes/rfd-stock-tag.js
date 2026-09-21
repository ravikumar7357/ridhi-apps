/* Tag every untagged "with you" count with the order the printer was working on when they typed it:
 * the order, among those carrying that size or cloth, on which they raised a requirement nearest in
 * time. Dry run unless --apply. Only ADDS orderId to each row; nothing is moved or deleted. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => {
    const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const U = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const [stock, vo, mdb] = await Promise.all([req('GET', 'pt_rfdStock'), req('GET', 'pt_vendorOrders'), req('GET', 'pt_masterDB')]);
  const mdbBy = {}; Object.values(mdb || {}).forEach(m => { if (m && m.sku) mdbBy[String(m.sku).toUpperCase()] = m; });
  const patch = {};
  for (const code of Object.keys(stock || {})) {
    const orders = Object.values(vo[code] || {}).filter(o => o && ['Received', 'Cancelled'].indexOf(o.status || 'Placed') < 0);
    for (const [k, row] of Object.entries(stock[code] || {})) {
      if (!row || row.orderId || k.indexOf('@') > 0) continue;
      const isM = k.indexOf('M__') === 0;
      /* orders that carry this size / cloth */
      const has = orders.filter(o => (o.lines || []).some(l => {
        if (isM) return 'M__' + U(l.fabricType || l.fabric) === k;
        /* the same as rfdPieceLines: the line's own subtype (or type) and size */
        const what = String(l.articleSubtype || l.articleType || '').trim().toLowerCase();
        return 'P__' + U(what + ' | ' + String(l.size || '').trim().toLowerCase()) === k;
      }));
      const t = Date.parse(row.at || 0);
      let best = null, bestGap = Infinity;
      has.forEach(o => Object.values(o.rfdReqs || {}).forEach(r => {
        const g = Math.abs(Date.parse(r.raisedAt || 0) - t);
        if (g < bestGap) { bestGap = g; best = o; }
      }));
      const why = best ? `nearest ask ${Math.round(bestGap / 60000)} min away` : (has.length === 1 ? 'only order with it' : '');
      if (!best && has.length === 1) best = has[0];
      console.log(`${code} ${k.padEnd(42)} ${String(row.pcs).padStart(5)}  → ${best ? best.orderNo : 'NOT TAGGED (' + has.length + ' orders carry it)'}  ${why}`);
      if (best) patch[`pt_rfdStock/${code}/${k}/orderId`] = best.id;
    }
  }
  console.log('\n' + Object.keys(patch).length + ' to tag');
  if (APPLY && Object.keys(patch).length) { await req('PATCH', '', patch); console.log('applied'); }
})().catch(e => { console.error(e.message); process.exit(1); });
