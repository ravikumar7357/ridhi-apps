/* THE DATABASE RULES, AND THE ONLY SAFE WAY TO CHANGE THEM.
 *
 *   node rules-tool.js drift      is pt_perms (what the rules read) the same as Firestore perms?
 *   node rules-tool.js seed       rewrite pt_perms from Firestore
 *   node rules-tool.js ghosts     rights on record with NO login behind them — see ghosts() for why that is a door
 *   node rules-tool.js check p0   play every account against the LIVE rules, expecting the behaviour before any of this
 *   node rules-tool.js check p1   …expecting phase 1 (the money nodes)
 *   node rules-tool.js check p3   …expecting phase 3: a login with no rights on record reads and writes NOTHING
 *   node rules-tool.js check p2   …expecting phase 2 (rates by the row, the master lists, vendor identity) — what ../database.rules.next.json promises
 *   node rules-tool.js deploy     seed → save the live rules → put the new ones → check new →
 *                                 PUT THE OLD ONES BACK BY ITSELF if a single answer is not the expected one
 *   node rules-tool.js rollback <file>
 *
 * HOW AN ACCOUNT IS PLAYED WITHOUT BEING SIGNED IN TO. The REST API takes auth_variable_override with
 * an admin token: the rules run exactly as they would for that person. No account is created, no
 * password is touched.
 *
 * HOW A WRITE IS TRIED WITHOUT WRITING. Every attempt is a delete of "<node>/zz_ruletest", a key that
 * does not exist. The rules run in full and answer 200 or 401; the data is the same afterwards either
 * way. The tool confirms nothing was left behind before it exits.
 *
 * WHAT IT EXPECTS IS WORKED OUT FROM FIRESTORE, NOT FROM pt_perms — so a copy that has drifted from
 * the real rights shows up as a wrong answer here instead of passing quietly.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const HOST = 'price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PROJ = 'price-research-48ff3';
/* Always an admin, with or without a perms document — firestore.rules and the app both say so, and the
 * database rules have to agree or the owner is the one person they lock out. */
const OWNER = 'ravi@thefabricrush.com';
const HERE = __dirname;
/* ONE FILE IS THE TRUTH. ../database.rules.json is what is LIVE, and firebase.json deploys it; the draft
 * waits beside it as database.rules.next.json and is copied over it only once it is live and every
 * account has been checked against it. Until then a plain "firebase deploy" still pushes the old rules. */
const LIVE_FILE = pathm.join(HERE, '..', 'database.rules.json');
const RULES = pathm.join(HERE, '..', 'database.rules.next.json');

let AT = '';
async function token() {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  AT = tok.access_token || tok;
}
function req(method, path, body, as, raw) {
  return new Promise((res, rej) => {
    const q = as === undefined ? '' : '?auth_variable_override=' + encodeURIComponent(JSON.stringify(as));
    const data = body === undefined ? null : (raw ? body : JSON.stringify(body));
    const r = https.request({ host: HOST, path: '/' + path + '.json' + q, method,
      headers: { Authorization: 'Bearer ' + AT, 'Content-Type': 'application/json' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res({ status: x.statusCode, body: d })); });
    r.on('error', rej); if (data !== null) r.write(data); r.end();
  });
}
const getu = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + AT } },
  r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));

const emailKey = e => String(e || '').toLowerCase().split('.').join(',');

/** Firestore perms, as plain objects. */
async function firestorePerms() {
  const out = []; let page = '';
  do {
    const j = await getu('https://firestore.googleapis.com/v1/projects/' + PROJ
      + '/databases/(default)/documents/perms?pageSize=300' + (page ? '&pageToken=' + page : ''));
    (j.documents || []).forEach(d => {
      const f = d.fields || {}, o = { email: d.name.split('/').pop().toLowerCase(), admin: false, r: {}, t: {} };
      Object.keys(f).forEach(k => {
        if (f[k].booleanValue === true) { if (k === 'admin') o.admin = true; else o.r[k] = true; }
      });
      ((f.replTabs && f.replTabs.arrayValue && f.replTabs.arrayValue.values) || [])
        .forEach(v => { if (v.stringValue) o.t[v.stringValue] = true; });
      out.push(o);
    });
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
/** The same people, as the RULES should see them: the owner is an admin whatever the documents say. */
async function peopleForRules() {
  const out = await firestorePerms();
  const me = out.find(p => p.email === OWNER);
  if (me) return out.map(p => (p.email === OWNER ? Object.assign({}, p, { admin: true }) : p));
  return out.concat([{ email: OWNER, admin: true, r: {}, t: {} }]);
}
/** The shape the rules read. Sellora's Access screen writes exactly this. */
const mirrorOf = p => { const m = { admin: p.admin === true };
  if (Object.keys(p.r).length) m.r = p.r; if (Object.keys(p.t).length) m.t = p.t; return m; };
const canon = o => JSON.stringify(Object.keys(o || {}).sort().reduce((a, k) => {
  a[k] = o[k] && typeof o[k] === 'object' ? JSON.parse(canon(o[k])) : o[k]; return a; }, {}));

async function drift(say) {
  const fsP = await firestorePerms();
  const live = JSON.parse((await req('GET', 'pt_perms')).body) || {};
  const bad = [];
  fsP.forEach(p => { const k = emailKey(p.email), have = Object.assign({}, live[k] || null);
    delete have.at; delete have.by;
    if (canon(have) !== canon(mirrorOf(p))) bad.push(p.email.split('@')[0] + (live[k] ? ' differs' : ' is missing')); });
  Object.keys(live).forEach(k => { if (!fsP.some(p => emailKey(p.email) === k)) bad.push(k.split('@')[0] + ' has a copy but no Firestore rights'); });
  if (say) console.log(bad.length ? 'DRIFT — ' + bad.length + ':\n  ' + bad.join('\n  ') : 'pt_perms matches Firestore for all ' + fsP.length + ' accounts.');
  return bad;
}

/**
 * RIGHTS WITH NO LOGIN BEHIND THEM ARE A DOOR.
 *
 * Self sign-up is open, and the rules know a person by the email in their token — unverified, because
 * the PIN logins have no mailbox to verify. So if rights are ever recorded for an address BEFORE that
 * person has a login, a stranger can sign up as that address first and the rights are theirs. Create
 * the login first, or grant the rights and make the login in the same sitting. This lists every such
 * address; on 2026-09-19 there were none. Also lists logins that hold no rights at all, which are
 * harmless now but are worth deleting when nobody can say whose they are.
 */
async function ghosts() {
  let users = [], page = '';
  do {
    const j = await new Promise((res, rej) => https.get('https://identitytoolkit.googleapis.com/v1/projects/' + PROJ + '/accounts:batchGet?maxResults=500'
      + (page ? '&nextPageToken=' + page : ''), { headers: { Authorization: 'Bearer ' + AT, 'x-goog-user-project': PROJ } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
    if (j.error) throw new Error('could not list the logins: ' + j.error.message);
    users = users.concat(j.users || []); page = j.nextPageToken || '';
  } while (page);
  const have = new Set(users.map(u => String(u.email || '').toLowerCase()).filter(Boolean));
  const fsP = await firestorePerms();
  const vbe = JSON.parse((await req('GET', 'pt_vendorByEmail')).body) || {};
  const ghost = fsP.filter(p => !have.has(p.email));
  const bare = [...have].filter(e => e !== OWNER && !fsP.some(p => p.email === e) && !vbe[emailKey(e)]);
  const NL = String.fromCharCode(10);
  console.log(ghost.length ? 'RIGHTS WITH NO LOGIN — a stranger could sign up as these and inherit them:' + NL + '  '
    + ghost.map(p => p.email.split('@')[0] + (p.admin ? '  (ADMIN)' : '')).join(NL + '  ')
    : 'Every set of rights has a login behind it (' + fsP.length + ').');
  console.log(bare.length ? 'Logins holding no rights at all (they can read and write nothing): ' + bare.map(e => e.split('@')[0]).join(', ') : 'No login is without rights.');
  return ghost;
}

async function seed() {
  const fsP = await firestorePerms(), all = {};
  fsP.forEach(p => { all[emailKey(p.email)] = Object.assign(mirrorOf(p), { at: new Date().toISOString(), by: 'rules-tool seed' }); });
  const r = await req('PUT', 'pt_perms', all);
  if (r.status !== 200) throw new Error('seed refused: ' + r.status + ' ' + r.body.slice(0, 200));
  console.log('pt_perms written for ' + fsP.length + ' accounts (' + fsP.filter(p => p.admin).length + ' admins).');
}

/* ---- what each kind of person should be able to write ---- */
const NODES = ['pt_perms', 'pt_payoutFreezes', 'pt_printerRates', 'pt_rateList', 'pt_advances', 'pt_empList',
  'pt_masterDB', 'pt_masters/accessories', 'pt_masters/vendor', 'pt_masters/colour', 'pt_masters/printRule',
  'pt_masters/ruffleRule', 'pt_masters/recipe', 'pt_masters/zz_someOtherList', 'pt_vendorByEmail', 'pt_loginDir',
  'pt_vendorMap', 'pt_vendorPin', 'pt_baseData', 'pt_orderBook', 'pt_salesOrders', 'pt_accLedger', 'zz_unnamedNode'];
/* Filled in by check(): the path of a rate that is APPROVED today, so that "may somebody without the
 * right touch an approved rate" is asked of a real one. */
let APPROVED_ROW = '';
function expectWrite(who, node, mode) {
  if (who.kind === 'nobody') return false;
  if (who.kind === 'vendor') return node === 'pt_vendorOrders/' + who.code;
  /* PHASE 3: signed in is not enough. Anybody can sign themselves up; only rights on record make staff. */
  if (mode === 'p3' && !who.p) return false;
  if (node.indexOf('pt_vendorOrders/') === 0) return true;          // staff write every vendor branch
  if (mode === 'p0') return true;                                    // before any of this: any staff, anything
  const p = who.p || { admin: false, r: {}, t: {} };
  if (mode === 'p2' || mode === 'p3') {
    if (APPROVED_ROW && node === APPROVED_ROW) return p.admin || !!p.r.rateApprove;   // an approved rate: approvers only
    if (node === 'pt_printerRates') return p.admin || !!p.r.rateApprove || !!p.t.hr;     // a new row: whoever holds Finance & HR
    if (node === 'pt_masters/accessories') return p.admin || !!p.r.accEdit;
    if (node === 'pt_masters/printRule' || node === 'pt_masters/ruffleRule') return p.admin || !!p.r.prodEdit;
    if (node === 'pt_masters/recipe') return p.admin || !!p.r.mdbEdit;
    if (node.indexOf('pt_masters/') === 0) return p.admin;
    if (node === 'pt_vendorByEmail' || node === 'pt_loginDir' || node === 'pt_vendorPin') return p.admin;
    if (node === 'pt_vendorMap') return p.admin || !!p.r.vreqApprove;
  }
  if (node === 'pt_perms' || node === 'pt_payoutFreezes') return p.admin;
  /* A row beneath the rate list is the rate list: in phase 1 the whole node answers for it. */
  if (node.indexOf('pt_printerRates') === 0 || node === 'pt_rateList' || node === 'pt_advances') return p.admin || !!p.t.hr;
  if (node === 'pt_empList') return p.admin || !!p.t.hr || !!p.r.empEdit;
  if (node === 'pt_masterDB') return p.admin || !!p.r.mdbEdit || !!p.r.prodEdit;
  return true;
}

async function check(mode) {
  const fsP = await peopleForRules();
  const vbe = JSON.parse((await req('GET', 'pt_vendorByEmail')).body) || {};
  const vk = Object.keys(vbe), v1 = vk[0], v2 = vk.find(k => vbe[k].code !== vbe[v1].code);
  const people = fsP.filter(p => !vbe[emailKey(p.email)]).map(p => ({ kind: 'staff', name: p.email.split('@')[0], email: p.email, p }));
  people.push({ kind: 'staff', name: '(signed in, no rights on record)', email: 'ruletest-nobody@example.invalid', p: null });
  people.push({ kind: 'vendor', name: '(a vendor)', email: v1.split(',').join('.'), code: vbe[v1].code, other: v2 ? vbe[v2].code : '' });
  people.push({ kind: 'nobody', name: '(not signed in)', email: '' });

  /* A rate that is approved today — a row with no status at all counts, because the app reads it so. */
  const pr = JSON.parse((await req('GET', 'pt_printerRates')).body);
  const prKey = Object.keys(pr || {}).find(k => pr[k] && pr[k].vendor && String(pr[k].status || '').toLowerCase() !== 'pending'
    && String(pr[k].status || '').toLowerCase() !== 'refused');
  APPROVED_ROW = prKey == null ? '' : 'pt_printerRates/' + prKey;

  const jobs = [];
  people.forEach(w => {
    const as = w.kind === 'nobody' ? null : { uid: 'ruletest', token: { email: w.email } };
    const nodes = NODES.slice();
    if (w.kind === 'vendor') { nodes.push('pt_vendorOrders/' + w.code); if (w.other) nodes.push('pt_vendorOrders/' + w.other); }
    else nodes.push('pt_vendorOrders/' + vbe[v1].code);
    if (APPROVED_ROW) nodes.push(APPROVED_ROW);
    nodes.forEach(n => jobs.push({ w, n, as, what: 'write', want: expectWrite(w, n, mode) }));
    /* And reading: staff read everything, a vendor reads its own branch only, nobody reads nothing. */
    jobs.push({ w, n: 'pt_printerRates', as, what: 'read', want: w.kind === 'staff' && !(mode === 'p3' && !w.p) });
    jobs.push({ w, n: 'pt_empList', as, what: 'read', want: w.kind === 'staff' && !(mode === 'p3' && !w.p) });
    if (w.kind === 'vendor') jobs.push({ w, n: 'pt_vendorOrders/' + w.code, as, what: 'read', want: true });
  });

  const wrong = []; let done = 0;
  for (let i = 0; i < jobs.length; i += 24) {
    await Promise.all(jobs.slice(i, i + 24).map(async j => {
      const r = j.what === 'write' ? await req('PATCH', '', { [j.n + '/zz_ruletest']: null }, j.as)
                                   : await req('GET', j.n + '/zz_ruletest', undefined, j.as);
      const got = r.status === 200; done++;
      if (got !== j.want) wrong.push(`${j.w.name}  ${j.what} ${j.n}: ${got ? 'ALLOWED' : 'refused'}, expected ${j.want ? 'allowed' : 'REFUSED'} (${r.status})`);
    }));
  }
  const left = (await req('GET', 'zz_unnamedNode')).body;
  console.log(`${done} attempts as ${people.length} people, expecting the ${mode} behaviour · left behind: ${left}`);
  if (wrong.length) { console.log('WRONG — ' + wrong.length + ':'); wrong.slice(0, 40).forEach(x => console.log('  ' + x)); }
  else console.log('every answer was the expected one.');
  if (mode !== 'p0' && !wrong.length) {
    const can = n => people.filter(w => w.kind === 'staff' && w.p && expectWrite(w, n, mode)).map(w => w.name).join(', ');
    console.log('\nwho may write, under the new rules:');
    ['pt_perms', 'pt_payoutFreezes', 'pt_printerRates', APPROVED_ROW, 'pt_empList', 'pt_masterDB', 'pt_masters/accessories',
      'pt_masters/printRule', 'pt_masters/recipe', 'pt_masters/vendor', 'pt_vendorByEmail', 'pt_vendorMap'].filter(Boolean)
      .forEach(n => console.log('  ' + (n === APPROVED_ROW ? 'an APPROVED rate' : n).padEnd(24) + can(n)));
  }
  return wrong;
}

const putRules = text => req('PUT', '.settings/rules', text, undefined, true);

(async () => {
  await token();
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'drift') return void await drift(true);
  if (cmd === 'ghosts') return void await ghosts();
  if (cmd === 'seed') { await seed(); return void await drift(true); }
  if (cmd === 'check') return void await check(['p0', 'p1', 'p2', 'p3'].indexOf(arg) >= 0 ? arg : 'p3');
  if (cmd === 'rollback') {
    const r = await putRules(fs.readFileSync(arg, 'utf8'));
    if (r.status === 200) fs.copyFileSync(arg, LIVE_FILE);
    return void console.log('rules put back from ' + arg + ': ' + r.status + ' ' + r.body.slice(0, 120));
  }
  if (cmd === 'deploy') {
    await seed();
    if ((await drift(false)).length) throw new Error('pt_perms does not match Firestore even after seeding — not deploying.');
    const before = (await req('GET', '.settings/rules')).body;
    const keep = pathm.join(HERE, 'rules-before-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(keep, before);
    console.log('live rules saved to ' + keep);
    const r = await putRules(fs.readFileSync(RULES, 'utf8'));
    if (r.status !== 200) throw new Error('the new rules were refused, nothing changed: ' + r.status + ' ' + r.body.slice(0, 300));
    console.log('new rules are live — checking every account now…');
    let wrong;
    try { wrong = await check('p3'); } catch (e) { wrong = ['the check itself failed: ' + (e.message || e)]; }
    if (wrong.length) {
      const back = await putRules(before);
      console.log('\nROLLED BACK (' + back.status + '). The old rules are live again. Nothing above was acceptable.');
      process.exit(2);
    }
    fs.copyFileSync(RULES, LIVE_FILE);
    return void console.log('\nDEPLOYED, and database.rules.json now says what is live.'
      + '\nTo undo:  node rules-tool.js rollback "' + keep + '"   (and restore database.rules.json from it)');
  }
  console.log('usage: node rules-tool.js drift | seed | ghosts | check p0|p1|p2|p3 | deploy | rollback <file>');
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
