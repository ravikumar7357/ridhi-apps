/* The database rule for the line hold (rules/build-rules.js → database.rules.next.json, pt_lineHold).
 * Ravi, 26 Nov: two screens saved the same pieces. The rule lets one screen hold a line for 5 minutes.
 * Each rule sentence is played here against made-up holds; the database's own check is run at deploy by rules-tool.js.
 *   node tests/line-hold-rule-test.js      (RULES_FILE=<file> tests another copy) */
const fs = require('fs'), path = require('path');
const FILE = process.env.RULES_FILE || path.join(__dirname, '..', 'database.rules.next.json');
const rules = new Function('return (' + fs.readFileSync(FILE, 'utf8') + ')')().rules;
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } };

const snap = v => ({ val: () => (v === undefined ? null : v), exists: () => v !== undefined && v !== null,
  child: k => snap(v ? v[k] : undefined), hasChildren: ks => !!v && ks.every(k => v[k] !== undefined) });
const NOW = 1800000000000, MIN = 60 * 1000;
const STAFF = { 'floor@made,up': {}, 'other@made,up': {} };
const root = snap({ pt_perms: STAFF, pt_vendorByEmail: { 'printer@made,up': { code: 'P1' } } });
const who = email => (email ? { token: { email } } : null);
const run = (expr, scope) => { try { return !!new Function(...Object.keys(scope), 'return (' + expr + ');')(...Object.values(scope)); } catch (e) { return false; } };

const hold = rules.pt_lineHold, line = hold && hold.$register && hold.$register.$line;
/** May this account change this hold from `old` to `next` (null = let it go)? */
function may(email, old, next) {
  const s = { auth: who(email), root, data: snap(old), newData: snap(next), now: NOW };
  return !!line && run(line['.write'], s) && (next === null || (run(line['.validate'], s)
    && Object.keys(next).every(k => run(line.$other['.validate'], { $other: k }))));
}
const H = (by, form, agoMin) => ({ by, form, at: NOW - agoMin * MIN });
const A = 'floor@made.up', B = 'other@made.up';

console.log('== reading ==');
ok('staff may read the holds (the app must see a hold to respect it)', !!hold && run(hold['.read'], { auth: who(A), root }));
ok('a printer may not', !!hold && !run(hold['.read'], { auth: who('printer@made.up'), root }));
ok('nobody signed out may', !!hold && !run(hold['.read'], { auth: null, root }));

console.log('== taking a line ==');
ok('a free line can be held', may(A, null, H(A, 'f1', 0)));
ok('a second person is refused while it is held', !may(B, H(A, 'f1', 1), H(B, 'f2', 0)));
ok('…still refused at 4 minutes 59', !may(B, H(A, 'f1', 4 + 59 / 60), H(B, 'f2', 0)));
ok('over 5 minutes old, somebody else may take it', may(B, H(A, 'f1', 6), H(B, 'f2', 0)));
ok('the same form may renew it (Save pressed again)', may(A, H(A, 'f1', 1), H(A, 'f1', 0)));
ok('a second PC on the same login is refused (another form)', !may(A, H(A, 'f1', 1), H(A, 'f2', 0)));

console.log('== letting go ==');
ok('the holder may let it go', may(A, H(A, 'f1', 1), null));
ok('another person may not', !may(B, H(A, 'f1', 1), null));
ok('an old one may be cleared by any staff', may(B, H(A, 'f1', 6), null));

console.log('== what a hold must say ==');
ok('not in somebody else\'s name', !may(B, null, H(A, 'f1', 0)));
ok('the time is the database\'s, not the PC\'s', !may(A, null, H(A, 'f1', -60)) && !may(A, null, H(A, 'f1', 10)));
ok('it names the form', !may(A, null, { by: A, at: NOW }));
ok('nothing else is stored in it', !may(A, null, Object.assign(H(A, 'f1', 0), { note: 'x' })));
ok('a printer cannot hold a line', !may('printer@made.up', null, H('printer@made.up', 'f1', 0)));
ok('a login with no rights on record cannot', !may('stranger@made.up', null, H('stranger@made.up', 'f1', 0)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
