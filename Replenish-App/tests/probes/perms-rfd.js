/* Who can work the RFD flow today: the rfd tab, rfdApprove, rfdSend (from pt_perms); which vendors have a login. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const perms = await get(DB + '/pt_perms.json') || {};
  const who = (pred) => Object.entries(perms).filter(([, p]) => p && pred(p)).map(([k]) => k.replace(/,/g, '.'));
  console.log('admins:', who(p => p.admin).join(', '));
  console.log('rfd tab:', who(p => p.t && p.t.rfd).join(', ') || 'NOBODY');
  console.log('rfdApprove:', who(p => p.r && p.r.rfdApprove).join(', ') || 'NOBODY');
  console.log('rfdSend:', who(p => p.r && p.r.rfdSend).join(', ') || 'NOBODY');
  console.log('vreqApprove:', who(p => p.r && p.r.vreqApprove).join(', ') || 'NOBODY');
  const vbe = await get(DB + '/pt_vendorByEmail.json') || {};
  const byCode = {}; Object.entries(vbe).forEach(([e, v]) => { const c = typeof v === 'string' ? v : (v && (v.code || v.vendorCode)); if (c) (byCode[c] = byCode[c] || []).push(e.replace(/,/g, '.')); });
  const vend = await get(DB + '/pt_masters/vendor.json') || {};
  Object.values(vend).filter(v => v && v.active !== false).forEach(v => console.log((v.code || '').padEnd(8), (v.desc || v.name || '').padEnd(28), String(v.category || '').padEnd(16), (byCode[v.code] || []).join(', ') || 'NO LOGIN'));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
