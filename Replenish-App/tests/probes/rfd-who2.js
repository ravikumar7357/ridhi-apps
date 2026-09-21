const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const perms = await get('pt_perms');
  for (const k of Object.keys(perms || {})) if (/tazeema|ecomridhi|kshoaib/i.test(k)) {
    const p = perms[k]; console.log(k, '| admin', !!p.admin, '| vendor', p.vendorCode || p.vendor || '-', '| tabs', JSON.stringify(p.replTabs || p.tabs || []));
  }
  const vo = await get('pt_vendorOrders/VND002');
  for (const oid of Object.keys(vo || {})) { const o = vo[oid]; if (o.orderNo !== 'VPO-260912-5QG') continue;
    const reqs = Object.values(o.rfdReqs || {});
    const need = (o.lines || []).reduce((a, l) => a + (+l.qty || 0), 0);
    console.log('order lines', (o.lines || []).length, 'qty', need, '| requests', reqs.length, 'pcs', reqs.reduce((a, r) => a + (+r.pieces || 0), 0));
    console.log('notes:', [...new Set(reqs.map(r => r.note))].join(' / ') || '(none)');
    console.log('stock on file:', JSON.stringify(await get('pt_rfdStock/VND002')).slice(0, 300));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
