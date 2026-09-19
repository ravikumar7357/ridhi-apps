/* WHAT CAN SOMEBODY WITH NO LOGIN AND NO PASSWORD REACH?
 *
 * Every request in part 1 is sent with NO credentials at all — exactly what a stranger with a browser
 * has. Nothing is written: the only "write" is a delete of a key that does not exist. Values that come
 * back are never printed; only whether anything came back, and how much.
 * Part 2 uses Ravi's own admin token, read-only, to look at settings a stranger cannot see but which
 * decide what a stranger can do (is sign-up open?).
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const anon = (method, url, body) => new Promise(res => {
  const u = new URL(url);
  const r = https.request({ host: u.host, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' }, timeout: 20000 },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d, loc: x.headers.location || '' })); });
  r.on('error', e => res({ status: 0, body: String(e.message || e) })); r.on('timeout', () => { r.destroy(); res({ status: 0, body: 'timeout' }); });
  if (body !== undefined) r.write(JSON.stringify(body)); r.end();
});
const verdict = (r, what) => {
  const open = r.status === 200 && r.body && r.body !== 'null' && r.body.length > 4;
  console.log('  ' + (open ? 'OPEN !!   ' : (r.status === 401 || r.status === 403 ? 'refused   ' : (r.status === 404 ? 'not there ' : (r.status === 0 ? 'no answer ' : 'closed    '))))
    + String(r.status).padEnd(4) + what + (open ? '   — ' + r.body.length + ' bytes came back' : ''));
  return open;
};

(async () => {
  let holes = 0;
  const NEW = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
  console.log('== 1. THE PRODUCTION DATABASE (payroll, rates, orders) — no login ==');
  for (const p of ['.json?shallow=true', 'pt_empList.json', 'pt_rateList.json', 'pt_printerRates.json', 'pt_perms.json', 'pt_vendorOrders.json', 'pt_vendorByEmail.json', 'pt_loginDir.json'])
    if (verdict(await anon('GET', NEW + '/' + p), 'read  /' + p)) holes++;
  const w = await anon('PATCH', NEW + '/.json', { 'zz_ruletest/x': null });
  console.log('  ' + (w.status === 200 ? 'OPEN !!   ' : 'refused   ') + String(w.status).padEnd(4) + 'write (a delete of nothing)'); if (w.status === 200) holes++;

  console.log('\n== 2. THE OLD PRODUCTION-TRACKER DATABASE — memory says it was open to the world ==');
  const olds = ['https://production-tracker-9b19f-default-rtdb.asia-southeast1.firebasedatabase.app', 'https://production-tracker-9b19f-default-rtdb.firebaseio.com',
    'https://production-tracker-9b19f.firebaseio.com', 'https://production-tracker-9b19f-default-rtdb.europe-west1.firebasedatabase.app'];
  let oldOpen = '';
  for (const b of olds) { const r = await anon('GET', b + '/.json?shallow=true');
    const moved = r.status === 404 && /correct_url|different region/i.test(r.body) ? (r.body.match(/https:[^"\\ ]+/) || [''])[0] : '';
    if (verdict(r, 'read  ' + b.replace('https://', '') + '/.json?shallow=true')) { holes++; oldOpen = b;
      try { const k = Object.keys(JSON.parse(r.body)); console.log('            node names visible to anybody: ' + k.length + ' — ' + k.slice(0, 12).join(', ') + (k.length > 12 ? ', …' : '')); } catch (e) {} break; }
    if (moved) console.log('            (it says the database lives at another URL)'); }
  if (oldOpen) for (const p of ['pt_empList', 'pt_rateList', 'pt_users', 'pt_baseData', 'pt_advances', 'pt_extraHours']) {
    const r = await anon('GET', oldOpen + '/' + p + '.json?shallow=true');
    let n = 0; try { n = Object.keys(JSON.parse(r.body) || {}).length; } catch (e) {}
    console.log('            ' + (r.status === 200 && n ? 'READABLE  ' : 'nothing   ') + p.padEnd(16) + (n ? n + ' records' : ''));
    if (oldOpen && p === 'pt_empList') { const ww = await anon('PATCH', oldOpen + '/.json', { 'zz_ruletest/x': null });
      console.log('            ' + (ww.status === 200 ? 'WRITABLE !! anybody can change or delete it' : 'write refused (' + ww.status + ')')); if (ww.status === 200) holes++; } }

  console.log('\n== 3. FIRESTORE (rights, the backend key, stock, listings) — no login ==');
  const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
  for (const p of ['perms', 'config/api', 'stock', 'repl', 'listings']) if (verdict(await anon('GET', FS + p), 'read  ' + p)) holes++;

  console.log('\n== 4. FILES ==');
  for (const b of ['price-research-48ff3.appspot.com', 'price-research-48ff3.firebasestorage.app'])
    if (verdict(await anon('GET', 'https://firebasestorage.googleapis.com/v0/b/' + b + '/o'), 'list  storage bucket ' + b)) holes++;
  for (const f of ['member-logins.csv', 'member-pins-2026-09-08.csv', 'hr-portal-backup-2026-09-11.json', 'database.rules.json', '.git/config', 'tests/prod-test.js', 'firebase.json'])
    for (const site of ['fabricrush-replenish.web.app', 'price-research-48ff3.web.app']) {
      const r = await anon('GET', 'https://' + site + '/' + f);
      /* Sellora rewrites every path to index.html, so a 200 that is the app's own page is not a leak. */
      const isApp = /<!doctype html|<html/i.test(r.body.slice(0, 300));
      if (r.status === 200 && !isApp) { console.log('  OPEN !!   200 ' + site + '/' + f + ' — ' + r.body.length + ' bytes'); holes++; } }
  console.log('  (the PIN lists, payroll backup, rules, tests and git folder were asked for on both sites — anything found is listed above)');

  /* ---- part 2: settings only the owner can read ---- */
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const own = (url) => new Promise(res => https.get(url, { headers: { Authorization: 'Bearer ' + at, 'x-goog-user-project': 'price-research-48ff3' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res({ raw: d.slice(0, 200) }); } }); }).on('error', e => res({ raw: String(e) })));

  console.log('\n== 5. CAN A STRANGER MAKE THEMSELVES A LOGIN? ==');
  const ac = await own('https://identitytoolkit.googleapis.com/admin/v2/projects/price-research-48ff3/config');
  if (ac.raw || ac.error) console.log('  could not read the sign-in settings: ' + JSON.stringify(ac.error ? ac.error.message : ac.raw).slice(0, 160));
  else {
    const email = ((ac.signIn || {}).email || {}), anonOn = ((ac.signIn || {}).anonymous || {}).enabled === true;
    const closed = ((ac.client || {}).permissions || {}).disabledUserSignup === true;
    console.log('  email + password sign-in : ' + (email.enabled ? 'on' : 'off'));
    console.log('  anonymous sign-in        : ' + (anonOn ? 'ON !!' : 'off'));
    console.log('  SELF SIGN-UP             : ' + (closed ? 'blocked — only an admin path can create an account' : 'OPEN !! — anybody can create an account with the public web key'));
    if (!closed && email.enabled) { holes++; console.log('     → and the production database lets ANY signed-in non-vendor read everything and write most of it.'); }
    if (anonOn) holes++;
  }

  console.log('\n== 6. THE BACKEND (Apps Script) — called with no key, and with a wrong one ==');
  const doc = await own(FS + 'config/api');
  const f = (doc.fields || {}); const urls = Object.keys(f).filter(k => /url/i.test(k) && f[k].stringValue && /^https:\/\/script\.google\.com/.test(f[k].stringValue));
  if (!urls.length) console.log('  no backend URL found in config/api to test');
  for (const k of urls) { const u = f[k].stringValue;
    for (const [label, q] of [['no key   ', '?action=ping'], ['wrong key', '?key=not-the-key&action=products']]) {
      let r = await anon('GET', u + q); if (r.status === 302 && r.loc) r = await anon('GET', r.loc);
      const leaks = r.status === 200 && r.body.length > 400 && !/unauthor|forbidden|invalid|bad key|denied|error/i.test(r.body.slice(0, 400));
      console.log('  ' + (leaks ? 'ANSWERS !!' : 'refused   ') + ' ' + k.padEnd(14) + label + '  → ' + r.status + ', ' + r.body.length + ' bytes' + (leaks ? '' : '  (' + r.body.replace(/\s+/g, ' ').slice(0, 60) + ')'));
      if (leaks) holes++; } }

  console.log('\n' + (holes ? holes + ' DOOR(S) OPEN.' : 'Every door tried was shut.'));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
