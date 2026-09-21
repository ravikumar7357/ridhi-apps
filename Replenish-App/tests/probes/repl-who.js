/* Who reads the full Replenishment snapshot today, and who will after canReplFull. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const BASE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const FULL = ['repl', 'article', 'target', 'top', 'prod', 'follow', 'india'];
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(BASE + p, { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  let docs = [], page = '';
  do { const r = await get('perms?pageSize=300' + (page ? '&pageToken=' + page : '')); docs = docs.concat(r.documents || []); page = r.nextPageToken; } while (page);
  const rows = docs.map(d => {
    const f = d.fields || {}, email = decodeURIComponent(d.name.split('/').pop());
    const tabs = ((f.replTabs || {}).arrayValue || {}).values ? f.replTabs.arrayValue.values.map(v => v.stringValue) : null;
    return { email, admin: !!(f.admin && f.admin.booleanValue), repl: !!(f.repl && f.repl.booleanValue), tabs };
  });
  const now = r => r.admin || r.repl;
  const after = r => r.admin || r.email === 'ravi@thefabricrush.com' || (r.repl && (!r.tabs || !r.tabs.length || r.tabs.some(t => FULL.includes(t))));
  const lose = rows.filter(r => now(r) && !after(r)), keep = rows.filter(r => after(r));
  console.log('accounts with perms:', rows.length, '| read the full snapshot today:', rows.filter(now).length, '| after:', keep.length);
  console.log('\nKEEP full:'); keep.forEach(r => console.log('  ', r.email, r.admin ? '(admin)' : '', r.tabs ? r.tabs.filter(t => FULL.includes(t)).join(',') || '(all — old grant)' : '(all — old grant)'));
  console.log('\nMOVE to slim:'); lose.forEach(r => console.log('  ', r.email, '→ screens:', (r.tabs || []).filter(t => ['shop', 'adj', 'shopify', 'pack', 'shopprod'].includes(t)).join(',')));
})().catch(e => { console.error(e.message); process.exit(1); });
