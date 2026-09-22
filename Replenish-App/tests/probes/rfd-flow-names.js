/* RFD STOCK MOVING ON ITS OWN: do the fabric names in cutting, RFD handovers and the opening stock agree? */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const led = Object.values(await get('pt_fabInvLedger') || {});
  const op = led.filter(r => r && r.txnType === 'OPENING_RFD');
  console.log('OPENING_RFD rows', op.length, 'sample', JSON.stringify(op[0]));
  console.log('opening fabrics', [...new Set(op.map(r => r.fabricType))].join(' | '));
  const kinds = {}; led.forEach(r => { kinds[r.txnType] = (kinds[r.txnType] || 0) + 1; }); console.log('ledger kinds', JSON.stringify(kinds));
  const cut = Object.values(await get('pt_cuttingData') || {});
  const recent = cut.filter(r => r && /\/09\/2026/.test(r.cutDate || ''));
  console.log('\ncut entries', cut.length, 'Sept', recent.length, 'with fabricUsed', cut.filter(r => r.fabricUsed != null).length);
  const fw = {}; cut.forEach(r => { const k = r.fabricWidth || '(none)'; fw[k] = (fw[k] || 0) + 1; });
  console.log('cut fabric names', Object.entries(fw).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x.join('×')).join(' | '));
  console.log('last cut', JSON.stringify(cut.sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || ''))).slice(-1)[0]));
  const dec = Object.values(await get('pt_rfdDecisions') || {});
  const sends = dec.filter(d => d && d.sends);
  const fm = {}; sends.forEach(d => { const k = (d.unit || '?') + ':' + (d.fabric || d.sku); fm[k] = (fm[k] || 0) + 1; });
  console.log('\ndecisions', dec.length, 'with sends', sends.length, JSON.stringify(fm).slice(0, 800));
  const ft = await get('pt_masters/fabricType');
  console.log('\nfabricType master', JSON.stringify(Object.values(ft || {}).slice(0, 3)), Object.values(ft || {}).map(f => f && (f.desc || f.code)).join(' | '));
})().catch(e => { console.error(e.message); process.exit(1); });
