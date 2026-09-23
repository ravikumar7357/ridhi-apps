/* The production rows for one Shopify order, and what the order still owes. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const no = process.argv[2] || 'SHP-3873';
  const ob = await get('pt_orderBook') || {};
  const rows = Object.values(ob).filter(x => x && String(x.orderNo || '').toUpperCase() === no.toUpperCase());
  console.log(no, '— rows in the order book:', rows.length);
  rows.forEach(r => console.log('  ', r.sku, '· qty', r.qty, '· pcs', r.pcs, '·', r.remarks || ''));
  const base = await get('pt_baseData') || {}, cut = await get('pt_cuttingData') || {};
  const work = Object.values(base).filter(b => b && String(b.orderNo || '').toUpperCase() === no.toUpperCase());
  const cuts = Object.values(cut).filter(c => c && String(c.orderNo || '').toUpperCase() === no.toUpperCase());
  console.log('  job work rows:', work.length, work.map(w => w.sku + ' issued ' + w.issuePieces + ' recv ' + w.receivedPieces).join(' | '));
  console.log('  cutting rows:', cuts.length, cuts.map(c => c.sku + ' ' + c.pieces).join(' | '));
})().catch(e => { console.error(e.message); process.exit(1); });
