/* WHO CAN SEE CPC ORDERS, AND WHERE — read-only.
 *
 * Ravi, 2026-09-23: "mene replenish me bhi access de diya but abhi bhi cpc ke order nahi dekh pa
 * rha h", with a photo of SELLORA's Shopify Orders on CPC Shopify — the app that has no API key for
 * that shop. CPC is fetched only by the Replenishment app, and only for an account that
 *   1. has the Shopify Orders screen there (perms.replTabs holds 'shop'), AND
 *   2. satisfies canRepl() (perms.repl == true, or admin) — without it Firestore refuses
 *      config/api, which is where the backend's address and key live, so nothing is fetched at all.
 * This prints both, per account, so the gap can be seen rather than guessed at.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const BASE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(BASE + p, { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  let docs = [], page = '';
  do {
    const r = await get('perms?pageSize=300' + (page ? '&pageToken=' + page : ''));
    docs = docs.concat(r.documents || []); page = r.nextPageToken;
  } while (page);
  const arr = f => (f && f.arrayValue && f.arrayValue.values ? f.arrayValue.values.map(v => v.stringValue) : null);
  const rows = docs.map(d => {
    const f = d.fields || {};
    return {
      email: decodeURIComponent(d.name.split('/').pop()),
      admin: !!(f.admin && f.admin.booleanValue),
      repl: !!(f.repl && f.repl.booleanValue),
      replTabs: arr(f.replTabs),
      tabs: arr(f.tabs),
      when: (d.updateTime || '').slice(0, 19).replace('T', ' '),
    };
  });
  const hasRepl = r => r.admin || (r.replTabs === null ? r.repl : r.replTabs.includes('shop'));
  const canRead = r => r.admin || r.repl;
  const sell = r => r.admin || (r.tabs || []).includes('shop');
  const ok = rows.filter(r => hasRepl(r) && canRead(r));
  const broken = rows.filter(r => hasRepl(r) && !canRead(r));
  const sellOnly = rows.filter(r => sell(r) && !hasRepl(r));
  console.log('accounts:', rows.length);
  console.log('\nCAN see CPC orders (Replenishment → Shopify Orders, and Firestore lets them read config/api):');
  ok.sort((a, b) => b.when.localeCompare(a.when)).forEach(r =>
    console.log('  ', r.email, r.admin ? '(admin)' : '', '· last changed', r.when));
  console.log('\nHAS the screen but CANNOT fetch — perms.repl is not true, so config/api is refused:');
  broken.forEach(r => console.log('  ', r.email, '· replTabs:', (r.replTabs || []).join(',') || '(none)', '· last changed', r.when));
  console.log('\nHas SELLORA\'s Shopify Orders only — CPC can never be fetched there (no API key for that shop):');
  sellOnly.sort((a, b) => b.when.localeCompare(a.when)).forEach(r =>
    console.log('  ', r.email, '· Sellora tabs:', (r.tabs || []).join(',') || '(all)', '· last changed', r.when));
  console.log('\nMost recently changed accounts, whatever they hold:');
  rows.slice().sort((a, b) => b.when.localeCompare(a.when)).slice(0, 8).forEach(r =>
    console.log('  ', r.when, r.email, '| repl:', r.repl, '| replTabs:', (r.replTabs || ['(all)']).join(','), '| sellora:', (r.tabs || ['(all)']).join(',')));
})().catch(e => { console.error(e.message); process.exit(1); });
