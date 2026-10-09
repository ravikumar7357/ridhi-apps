/* Listing images backend check: node limg-probe.js get <SP|CPC> <sku|asin>
 *                                 node limg-probe.js post '<json body without key>'
 * Key/url read from Firestore config/api, never printed. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, method, body, auth) => new Promise((res, rej) => { const r = https.request(u, { method: method || 'GET', headers: Object.assign({ 'Content-Type': body ? 'text/plain' : 'application/json' }, auth === false ? {} : { Authorization: 'Bearer ' + at }), timeout: 300000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(x.headers.location, 'GET', null, false).then(res, rej); try { res(JSON.parse(d)); } catch (e) { rej(new Error(x.statusCode + ' not JSON: ' + d.slice(0, 200))); } }); }); r.on('error', rej); if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end(); });
  const api = await req(FS + 'config/api'); const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const [mode, a, b] = process.argv.slice(2);
  let out;
  if (mode === 'get') {
    const u = new URL(url); u.searchParams.set('key', key); u.searchParams.set('limg', 'get'); u.searchParams.set('brand', a);
    u.searchParams.set(/^[A-Z0-9]{10}$/.test(b) && /^B0/.test(b) ? 'asin' : 'sku', b);
    out = await req(u.toString(), 'GET', null, false);
  } else if (mode === 'raw') {
    const u = new URL(url); u.searchParams.set('key', key); Object.entries(JSON.parse(a)).forEach(([k, v]) => u.searchParams.set(k, v));
    out = await req(u.toString(), 'GET', null, false);
  } else {
    const body = Object.assign(JSON.parse(a.startsWith('@') ? fs.readFileSync(a.slice(1), 'utf8') : a), { key });
    out = await new Promise((res, rej) => { const r = https.request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' } }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.headers.location) return req(x.headers.location, 'GET', null, false).then(res, rej); res(d); }); }); r.on('error', rej); r.write(JSON.stringify(body)); r.end(); });
  }
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
})().catch(e => { console.error(e.message); process.exit(1); });
