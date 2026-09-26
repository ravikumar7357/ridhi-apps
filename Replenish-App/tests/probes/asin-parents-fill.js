/* Parent ASIN for master rows that have an ASIN and no parent, from Amazon's catalogue through the Pricing-API ?parents=
 * endpoint (20 a call). Blanks only. node asin-parents-fill.js [--write] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const RE = /^[A-Z0-9]{10}$/;
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, method, body, auth) => new Promise((res, rej) => { const r = https.request(u, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, auth === false ? {} : { Authorization: 'Bearer ' + at }), timeout: 120000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(x.headers.location, 'GET', null, false).then(res, rej); if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else { try { res(JSON.parse(d)); } catch (e) { rej(new Error('not JSON: ' + d.slice(0, 120))); } } }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const api = await req(FS + 'config/api'); const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const mdb = await req(DB + '/pt_masterDB.json');
  const need = Object.entries(mdb).filter(([, m]) => m && RE.test(String(m.asin || '').trim().toUpperCase()) && !String(m.parentAsin || '').trim());
  const asins = [...new Set(need.map(([, m]) => String(m.asin).trim().toUpperCase()))];
  console.log('rows with ASIN and no parent', need.length, '· distinct ASINs', asins.length);
  const parents = new Map(); let single = 0, notFound = 0, errs = 0;
  /* Each brand's credentials see only its own catalogue: ask as SP first, then as CPC for whatever SP did not know. */
  let todo = asins;
  for (const brand of ['SP', 'CPC']) {
    const missing = [];
    for (let i = 0; i < todo.length; i += 20) {
      const chunk = todo.slice(i, i + 20);
      try {
        const d = await req(url + '?key=' + encodeURIComponent(key) + '&brand=' + brand + '&parents=' + chunk.join(','), 'GET', null, false);
        if (!d.ok) throw new Error(d.error || 'not ok');
        Object.entries(d.parents || {}).forEach(([a, p]) => parents.set(a, String(p).toUpperCase()));
        single += (d.single || []).length; (d.notFound || []).forEach(a => missing.push(a));
      } catch (e) { errs++; if (errs <= 3) console.log('  batch failed:', e.message); }
      if ((i / 20) % 10 === 0) process.stdout.write('.');
    }
    console.log(' ' + brand + ': not known', missing.length);
    todo = missing;
  }
  notFound = todo.length;
  console.log('\nparents found', parents.size, '· stand-alone', single, '· not found', notFound, '· failed batches', errs);
  const patch = {}; need.forEach(([k, m]) => { const p = parents.get(String(m.asin).trim().toUpperCase()); if (p) patch['pt_masterDB/' + k + '/parentAsin'] = p; });
  console.log('would write', Object.keys(patch).length, 'parentAsin fields');
  if (process.argv[2] !== '--write') return console.log('dry run');
  const undo = {}; Object.keys(patch).forEach(p => { undo[p] = null; });
  fs.writeFileSync(pathm.join(__dirname, 'asin-parents-undo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify(undo));
  await req(DB + '/.json', 'PATCH', patch);
  console.log('written');
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
