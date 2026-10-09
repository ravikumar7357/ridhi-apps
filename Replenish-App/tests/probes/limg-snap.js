/* Build the Image Manager snapshot (imgsnap/{brand} + imgrows/{brand}_{i}) the same way the tab does.
 * node limg-snap.js SP|CPC [--write] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const PFX = 'https://m.media-amazon.com/images/I/';
const brand = process.argv[2], write = process.argv.includes('--write');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, method, body, auth) => new Promise((res, rej) => { const r = https.request(u, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, auth === false ? {} : { Authorization: 'Bearer ' + at }), timeout: 300000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(x.headers.location, 'GET', null, false).then(res, rej); try { const j = JSON.parse(d); if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 300))); else res(j); } catch (e) { rej(new Error(x.statusCode + ' not JSON: ' + d.slice(0, 200))); } }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const api = await req(FS + 'config/api'); const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const call = async q => { const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('limg', 'page'); u.searchParams.set('brand', brand); Object.entries(q).forEach(([k, v]) => v && u.searchParams.set(k, v)); const r = await req(u.toString(), 'GET', null, false); if (!r.ok) throw new Error(r.error); return r; };
  /* Amazon stops a search at 1,000: split created-date windows until each holds fewer. */
  const wins = [], todo = [[Date.parse('2010-01-01T00:00:00Z'), Date.now() + 864e5]];
  while (todo.length) {
    const [a, b] = todo.shift();
    const n = (await call({ count: '1', after: new Date(a).toISOString(), before: new Date(b).toISOString() })).total;
    if (!n) continue;
    if (n > 990 && b - a > 60e3) { const m = Math.floor((a + b) / 2); todo.unshift([a, m], [m, b]); continue; }
    wins.push([a, b, n]);
  }
  console.log(brand, 'windows', wins.map(w => w[2]).join('+'), '=', wins.reduce((s, w) => s + w[2], 0));
  let items = [];
  for (const [a, b] of wins) {
    let token = '';
    do { const r = await call({ pages: '40', token, after: new Date(a).toISOString(), before: new Date(b).toISOString() }); items = items.concat(r.items); token = r.next || ''; } while (token);
    console.log(brand, items.length);
  }
  const seen = new Set(); items = items.filter(x => !seen.has(x.sku) && seen.add(x.sku));
  const pm = m => { const o = {}; Object.keys(m || {}).forEach(k => o[k] = m[k].startsWith(PFX) ? m[k].slice(PFX.length) : m[k]); return o; };
  const packed = items.map(x => { const o = Object.assign({}, x, { live: pm(x.live), img: pm(x.img) }); delete o.main; Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === '') delete o[k]; }); return o; });
  fs.writeFileSync(pathm.join(process.env.TEMP, 'imgsnap-' + brand + '.json'), JSON.stringify(packed));
  const diff = items.filter(x => x.live && Object.keys(x.img).some(s => x.live[s] && x.img[s] !== x.live[s])).length;
  console.log('listings', items.length, 'parents', items.filter(x => x.lvl === 'parent').length, 'live!=submitted', diff, 'bytes', JSON.stringify(packed).length);
  if (!write) return;
  // Firestore REST value encoding
  const enc = v => v === null || v === undefined ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
    : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, w]) => [k, enc(w)])) } }
    : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  const CH = 500, chunks = Math.ceil(packed.length / CH) || 1;
  for (let i = 0; i < chunks; i++) await req(FS + 'imgrows/' + brand + '_' + i, 'PATCH', { fields: { r: enc(packed.slice(i * CH, (i + 1) * CH)) } });
  await req(FS + 'imgsnap/' + brand, 'PATCH', { fields: { chunks: enc(chunks), n: enc(packed.length), at: { timestampValue: new Date().toISOString() }, by: enc('claude (limg-snap.js)') } });
  console.log('written', chunks, 'chunks');
})().catch(e => { console.error(e.message); process.exit(1); });
