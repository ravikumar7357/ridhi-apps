/* Why a Shopify line Ravi says needs production is not on the Order Console: was it ever opened (pt_trash keeps every
 * deleted pt_orderBook row), and when. Read-only. node probes/missing-why.js <keys.json> <out.json> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at }, timeout: 300000 },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const trash = await get('pt_trash') || {};
  const out = [];
  Object.values(trash).forEach(t => {
    if (!t || !/^pt_orderBook/.test(String(t.path || ''))) return;
    const vals = /^pt_orderBook\/[^/]+$/.test(t.path) ? [t.value] : (t.path === 'pt_orderBook' ? Object.values(t.value || {}) : []);
    vals.forEach(v => { if (v && (v.src === 'SHP' || /^SHP-/.test(v.orderNo || ''))) out.push({ at: t.at, by: t.by, tab: t.tab, why: t.why, path: t.path,
      shop: String(v.shopOrderNo || '').replace(/\s+/g, '').toUpperCase(), sku: String(v.sku || '').toUpperCase(), orderNo: v.orderNo, qty: v.qty, openedFrom: v.openedFrom || '', openedAt: v.openedAt || v.uploadedAt || '' }); });
  });
  console.log('trash rows', Object.keys(trash).length, 'SHP order-book rows deleted', out.length);
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
