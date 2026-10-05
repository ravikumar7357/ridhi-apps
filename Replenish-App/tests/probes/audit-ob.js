/* Every pt_audit save that touched a Shopify pt_orderBook row, Aug–Oct 2026. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at }, timeout: 600000 },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const out = []; let sample = null;
  for (const ym of ['2026-08', '2026-09', '2026-10']) {
    const a = await get('pt_audit/' + ym) || {};
    let n = 0;
    Object.values(a).forEach(r => { n++; if (!r) return;
      const blob = JSON.stringify(r);
      if (!/pt_orderBook\/ob_shp/i.test(blob)) return;
      if (!sample) sample = r;
      out.push(r); });
    console.log(ym, 'saves', n, 'touching SHP order book', out.length);
  }
  console.log(JSON.stringify(sample).slice(0, 1500));
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
