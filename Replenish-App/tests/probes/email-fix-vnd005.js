/* Ravi, 2026-09-26: VND005 Friends Creations was saved as thecrownandloon@gmail.com — the real address is
 * thecrownandloom@gmail.com (already right in pt_perms). Fixes the four places the typo sits, in ONE patch, after a backup. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const BAD = 'thecrownandloon@gmail.com', GOOD = 'thecrownandloom@gmail.com';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(JSON.parse(d))); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const paths = ['pt_masters/vendor/r4', 'pt_vendorMap/VND005', 'pt_vendorByEmail/thecrownandloon@gmail,com', 'pt_vendorByEmail/thecrownandloom@gmail,com', 'pt_loginDir/9414046837'];
  const before = {}; for (const p of paths) before[p] = await req('GET', p);
  if (!before[paths[0]] || before[paths[0]].email !== BAD || before[paths[0]].code !== 'VND005') throw new Error('vendor master row is not what was read before — stopping');
  const bf = pathm.join(__dirname, 'email-fix-vnd005-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(bf, JSON.stringify(before, null, 1));
  const now = new Date().toISOString();
  const patch = {
    'pt_masters/vendor/r4/email': GOOD, 'pt_masters/vendor/r4/modifiedAt': now, 'pt_masters/vendor/r4/modifiedBy': 'ravi@thefabricrush.com',
    'pt_vendorMap/VND005/email': GOOD,
    'pt_vendorByEmail/thecrownandloom@gmail,com': before['pt_vendorByEmail/thecrownandloon@gmail,com'] || { code: 'VND005', name: 'Friends Creations', phone: '9414046837' },
    'pt_vendorByEmail/thecrownandloon@gmail,com': null,
    'pt_loginDir/9414046837/email': GOOD, 'pt_loginDir/9414046837/updatedAt': now,
  };
  const r = await req('PATCH', '', patch);
  console.log(r && r.error ? 'ERROR ' + r.error : 'written', '· backup', bf);
  for (const p of paths) console.log(p, '=>', JSON.stringify(await req('GET', p)));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
