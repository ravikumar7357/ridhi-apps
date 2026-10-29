/* PHASE 4 — what is stored when staff ask: Meera's real meera.js (switch "learn") talking to the real router code, its
 * real tables (schema.sql) played by Node's SQLite. Questions carry a karigar's name, a phone number, an order number and
 * an amount; every row the database keeps is printed, and checked for anything personal. Then the same with the switch
 * off: nothing may be sent at all.   node meera/tools/phase4-privacy.mjs   (no internet, no accounts) */
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../router/src/worker.js';
import { store } from '../router/src/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..', '..');
const require = createRequire(import.meta.url);
const { load } = require('../tests/harness.cjs');
const ORIGIN = 'https://fabricrush-replenish.web.app';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(HERE, '..', 'router', 'schema.sql'), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { db.prepare(sql).run(...args); return { success: true }; },
    _run: () => ({ results: /RETURNING/i.test(sql) ? db.prepare(sql).all(...args) : (db.prepare(sql).run(...args), []) }),
  });
  return { prepare: sql => stmt(sql), batch: async list => list.map(s => s._run()), raw: db };
}
/* the people the ERP knows (made up) and who is signed in */
const PEOPLE = [[1, 'Ramesh Kumar'], [2, 'Raju Singh'], [3, 'Salma Bano']];
const USERS = { 'tok-staff': { uid: 'uid-staff-7Q2', email: 'karan@company.in', admin: false }, 'tok-admin': { uid: 'uid-admin-1A', email: 'ravi@thefabricrush.com', admin: true } };

async function run(switches, tokenName) {
  const db = d1(), env = { ENABLED: 'true', ALLOWED_ORIGINS: ORIGIN, ADMIN_EMAILS: 'ravi@thefabricrush.com', LEARN_DAILY: '30', DB: db };
  const M = await load({ root: ROOT, bundle: true, switches, handle: true });
  const T = c => M.ctx.__meeraTest(c);
  M.ctx.PTE.emp = PEOPLE;
  M.ctx.PTG = { masters: { vendor: { v1: { code: 'SHP', name: 'Shree Printers' } } }, mdb: [{ sku: 'RCN148', brand: 'Ridhi' }] };   // a party the ERP knows
  M.ctx.ME.admin = tokenName === 'tok-admin';   // what the ERP knows about this person
  M.ctx.auth = { currentUser: { getIdToken: async () => tokenName } };
  M.ctx.localStorage.setItem('guideAiFull', new Date().toISOString().slice(0, 10));   // no AI in this test: learning only
  const sent = [];
  const pageFetch = M.ctx.fetch;
  M.ctx.fetch = async (url, opt = {}) => {
    if (!String(url).startsWith('https://meera-router.')) return pageFetch(url, opt);
    sent.push({ path: new URL(url).pathname, body: opt.body ? JSON.parse(opt.body) : null });
    const req = new Request('https://router.example' + new URL(url).pathname, { method: opt.method || 'GET', headers: { ...(opt.headers || {}), origin: ORIGIN }, body: opt.body });
    const r = await handle(req, env, { store: store(db), verify: async tok => USERS[tok] || null, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
    const body = await r.json();
    return { ok: r.status < 300, status: r.status, json: async () => body };
  };
  const ask = async q => { await T(`gaAsk(${JSON.stringify(q)})`); await new Promise(r => setTimeout(r, 30)); };
  /* 1. questions she cannot answer, with a name, a phone, an order number and an amount in them */
  await ask('Ramesh Kumar ko ₹4,500 advance diya order 1234 ka, phone 98765 43210, ab kaha likhu');
  await ask('Raju Singh ke paas SHP-3365 ke 50 piece hain aur Rs. 1200 baaki hai, kya karu');
  await ask('Salma Bano ka payment 1200/- invoice no 77 kab aayega, mail salma@gmail.com');
  /* a name on no list (the karigar list not loaded, or a new person), and a party's name */
  await ask('mohan ko maal diya tha wo kab wapas aayega, kaha dekhu');
  await ask('Kal Prakash bhai ne kaha ki Shree Printers ka bill nahi aaya, kya karu');
  /* 2. a 👎 on an answer, then the one line back */
  await ask('karigar ko kaam kaise de');
  await T("meeraLearnDown(GA.lastQ, 'pr-jw-issue')");
  await new Promise(r => setTimeout(r, 30));
  const down = sent.filter(x => x.path === '/learn').pop();
  const lastId = db.raw.prepare("SELECT id, key FROM learn WHERE kind = 'down' ORDER BY id DESC").get();
  if (lastId) await T(`mlCall('/learn/note', { id: ${lastId.id}, key: ${JSON.stringify(lastId.key)}, note: gaClean('Raju Singh ka order 4212444076 aur 98765 43210 chahiye tha', gaNames()), names: gaNames() })`);
  /* 3. a misspelt question, then a suggested answer tapped */
  await ask('kariger ko maaal kaise de');
  await T("meeraLearnTap('how to give job work to karigar')");
  await new Promise(r => setTimeout(r, 30));
  const before = sent.length;   // what Meera herself sent (the test's own admin call below is not counted)
  /* the admin page */
  const adminSees = await T("mlCall('/admin/learn', null, 'GET').then(r => r.status)");
  const menu = T('meeraLearnMenu()');
  return { db, sent: sent.slice(0, before), down, adminSees, menu };
}

const PRIVATE = /ramesh|raju|salma|kumar|singh|bano|mohan|prakash|shree|4,?500|1234|1200|98765|43210|3365|4212444076|salma@|gmail|karan@|uid-staff|uid-admin|ravi@/i;
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

console.log('\n=== switch "learn" ON, signed in as staff ===');
const on = await run(['learn', 'spell'], 'tok-staff');
const rows = on.db.raw.prepare('SELECT * FROM learn ORDER BY id').all();
console.log('\nWHAT LEFT THE BROWSER (each request body, people names list shortened):');
for (const s of on.sent) console.log('  ' + s.path + '  ' + JSON.stringify({ ...s.body, names: s.body && s.body.names ? `[${s.body.names.length} names, for cleaning only]` : undefined }));
console.log('\nWHAT THE DATABASE KEPT — table learn (every column):');
for (const r of rows) console.log('  ' + JSON.stringify(r));
const usage = on.db.raw.prepare('SELECT * FROM usage').all();
console.log('table usage (the daily count):');
for (const u of usage) console.log('  ' + JSON.stringify(u));
console.log('');
ok(rows.length >= 4, rows.length + ' records kept (the questions she could not answer or was not sure of, 1 👎, 1 spelling; a question she answered is not kept)');
ok(!rows.some(r => PRIVATE.test(JSON.stringify(r))), 'no name, phone, order number, amount, email or sign-in id in any record');
ok(!usage.some(u => PRIVATE.test(JSON.stringify(u))), 'no sign-in id in the daily count either');
ok(!on.sent.some(s => PRIVATE.test(JSON.stringify({ ...s.body, names: undefined }))), 'nothing personal left the browser in a question or a note (names go only as the cleaning list)');
ok(rows.some(r => r.kind === 'down' && r.note && /\[NAME\]/.test(r.note)), 'the 👎 note is kept, cleaned');
ok(rows.some(r => r.kind === 'spelling' && r.answer === 'pr-jw-issue'), 'the misspelling and the answer then chosen are kept');
ok(rows.every(r => r.role === 'staff'), 'only the role: staff');
ok(on.adminSees === 403 && on.menu === '', 'a staff member: no learning page in the menu, and the router refuses it (403)');

console.log('\n=== switch "learn" ON, signed in as an admin ===');
const adm = await run(['learn', 'spell'], 'tok-admin');
ok(adm.adminSees === 200 && /Meera's learning/.test(adm.menu), 'an admin: the menu has "Meera\'s learning", and the router opens it');

console.log('\n=== switch "learn" OFF (as everyone has it) ===');
const off = await run(['spell'], 'tok-staff');
ok(off.sent.length === 0, 'nothing sent: ' + off.sent.length + ' requests');
ok(off.db.raw.prepare('SELECT COUNT(*) AS n FROM learn').get().n === 0, 'nothing stored');

console.log('\n=== switch ON but nobody signed in ===');
const anon = await run(['learn'], null);
ok(anon.sent.length === 0, 'nothing sent without a sign-in');

console.log(`\nphase4-privacy: ${fail ? fail + ' FAILED' : 'all passed'}`);
process.exit(fail ? 1 : 0);
