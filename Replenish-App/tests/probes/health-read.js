/* Read the Listing Health snapshot (health/{brand} + healthrows/{brand}_{i}) and print today's shape.
 * node health-read.js            Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = u => new Promise((res, rej) => { https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 300000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); } }); }).on('error', rej); });
  const dec = v => v == null ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? v.timestampValue
    : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, w]) => [k, dec(w)])) : null;
  for (const b of ['SP', 'CPC']) {
    const head = await req(FS + 'health/' + b);
    if (!head.fields) { console.log(b, 'no snapshot'); continue; }
    const f = Object.fromEntries(Object.entries(head.fields).map(([k, v]) => [k, dec(v)]));
    let rows = [];
    for (let i = 0; i < (f.chunks || 0); i++) {
      const c = await req(FS + 'healthrows/' + b + '_' + i);
      if (c.fields) rows = rows.concat(dec(c.fields.r) || []);
    }
    const n = rows.length;
    const content = rows.filter(r => r.c);
    const num = a => a.length;
    const stat = {};
    rows.forEach(r => { const s = r.st || '(none)'; stat[s] = (stat[s] || 0) + 1; });
    console.log('=====', b, 'listings', n, '| read at', f.at, '| content at', f.contentAt, '| scope', JSON.stringify(f.scope));
    console.log('  content read      :', content.length, '(' + Math.round(content.length / n * 100) + '%)');
    console.log('  A+ known          :', num(rows.filter(r => r.ap === 1 || r.ap === 0)), ' with A+:', num(rows.filter(r => r.ap === 1)));
    console.log('  no image at all   :', num(content.filter(r => (r.c[1] || 0) === 0)));
    console.log('  fewer than 7 imgs :', num(content.filter(r => (r.c[1] || 0) > 0 && r.c[1] < 7)));
    console.log('  fewer than 5 bulls:', num(content.filter(r => (r.c[2] || 0) < 5)));
    console.log('  description < 1000:', num(content.filter(r => (r.c[3] || 0) < 1000)));
    console.log('  title over 200    :', num(content.filter(r => (r.c[0] || 0) > 200)));
    console.log('  title under 80    :', num(content.filter(r => (r.c[0] || 0) > 0 && r.c[0] < 80)));
    console.log('  out of stock      :', num(rows.filter(r => r.q === 0)), ' | qty unknown:', num(rows.filter(r => r.q == null)));
    console.log('  no price          :', num(rows.filter(r => r.pr == null || r.pr === 0)));
    console.log('  statuses          :', JSON.stringify(stat));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
