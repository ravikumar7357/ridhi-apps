/* Offline check of the two new Listing Health rules: join the health rows with the Amazon snapshot.
 * Read-only. node health-amz-sim.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const req = u => new Promise((res, rej) => {
    https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 300000 }, x => {
      let d = '';
      x.on('data', c => d += c);
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } });
    }).on('error', rej);
  });
  const dec = v => v == null ? null
    : 'stringValue' in v ? v.stringValue
    : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue
    : 'booleanValue' in v ? v.booleanValue
    : 'timestampValue' in v ? v.timestampValue
    : 'nullValue' in v ? null
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, w]) => [k, dec(w)]))
    : null;

  const amz = new Map();
  for (const b of ['SP', 'CPC']) {
    const h = await req(FS + 'imgsnap/' + b);
    const n = dec(h.fields.chunks) || 0;
    for (let i = 0; i < n; i++) {
      const c = await req(FS + 'imgrows/' + b + '_' + i);
      (dec(c.fields.r) || []).forEach(x => { if (x && x.sku) amz.set(b + '|' + x.sku, { st: x.st || '', ie: x.ie || 0, im: x.im || '' }); });
    }
  }
  console.log('Amazon snapshot in Firestore:', amz.size, 'listings; with an ERROR:', [...amz.values()].filter(a => a.ie).length);

  let joined = 0, sup = 0, err = 0, miss = 0, tot = 0;
  for (const b of ['SP', 'CPC']) {
    const h = await req(FS + 'health/' + b);
    const n = dec(h.fields.chunks) || 0;
    let rows = [];
    for (let i = 0; i < n; i++) {
      const c = await req(FS + 'healthrows/' + b + '_' + i);
      if (c.fields) rows = rows.concat(dec(c.fields.r) || []);
    }
    let bs = 0, be = 0;
    rows.forEach(r => {
      tot++;
      const a = amz.get(b + '|' + r.s);              // packed rows: the SKU is `s`
      if (!a) { miss++; return; }
      joined++;
      const st = String(a.st).toUpperCase();
      if (st.includes('BUYABLE') && !st.includes('DISCOVERABLE')) { sup++; bs++; }
      if (a.ie) { err++; be++; }
    });
    console.log(b, 'health rows', rows.length, '| suppressed', bs, '| Amazon error', be);
  }
  console.log('health rows', tot, '| matched to the Amazon snapshot', joined, '| no match', miss);
  console.log('NEW criticals Listing Health will show: suppressed', sup, '+ Amazon error', err);
})().catch(e => { console.error(e.message); process.exit(1); });
