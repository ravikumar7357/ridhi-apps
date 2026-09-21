/* Set perms.repl = false on accounts that hold only factory sections. Touches that one field only
 * (updateMask), prints before/after. Ravi approved these four on 2026-09-21. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const BASE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/perms/';
const WHO = ['tazeema433@gmail.com', 'erp.ridhi@gmail.com', 'mohit.mahawar@ridhihome.com', 'vikas.mahawar@thefabricrush.com'];
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, url, body) => new Promise((res, rej) => { const r = https.request(url, { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => x.statusCode >= 300 ? rej(new Error(x.statusCode + ' ' + d.slice(0, 200))) : res(JSON.parse(d))); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  for (const e of WHO) {
    const url = BASE + encodeURIComponent(e);
    const before = await req('GET', url);
    const tabs = (((before.fields || {}).replTabs || {}).arrayValue || {}).values || [];
    await req('PATCH', url + '?updateMask.fieldPaths=repl', { fields: { repl: { booleanValue: false } } });
    const after = await req('GET', url);
    const tabsAfter = (((after.fields || {}).replTabs || {}).arrayValue || {}).values || [];
    console.log(e.padEnd(34), 'repl', before.fields.repl.booleanValue, '→', after.fields.repl.booleanValue,
      '| sections kept:', tabsAfter.map(v => v.stringValue).join(','), tabs.length === tabsAfter.length ? '' : ' !! SECTIONS CHANGED');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
