/* PROBE / PATCH WRITES TO SYNCED REGISTERS (Step 4d) — static check, no database.
 *   node tests/probe-writes-test.js
 * A hand-run script that writes one of the eight synced registers without leaving its pt_sync change note makes every
 * browser copy wrong for that row. So every script in tests/probes and tests/patches that writes (PUT / PATCH / DELETE)
 * and names a synced register must use tests/probes/_noted-write.js. Also: sync-sample.js must never write, and
 * sync-reset.js may write only pt_sync/_reset. The checker is tried on made-up scripts too, so it cannot pass by being blind. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const NW = require('./probes/_noted-write.js');
const SAMPLE = require('./probes/sync-sample.js');

const SYNCED = /pt_(orderBook|masterDB|cuttingData|pressInventory|shopProd|masters|cuttingFreezes|qcChecks)\b/;
/** Does this script text write to a database? A comparison such as c.method === 'PUT' is only reading one. */
function writes(text) {
  const re = /(['"`])(PUT|PATCH|DELETE)\1/g; let m;
  while ((m = re.exec(text))) { if (!/[!=]==?\s*$/.test(text.slice(Math.max(0, m.index - 8), m.index))) return true; }
  return false;
}
/** The scripts that write a synced register but do not use the helper. */
const unrouted = files => files.filter(f => !f.name.endsWith('_noted-write.js') && writes(f.text) && SYNCED.test(f.text) && !/_noted-write/.test(f.text)).map(f => f.name);

console.log('== the checker itself ==');
ok('a script that PATCHes pt_orderBook without the helper is caught',
  unrouted([{ name: 'x.js', text: "const call = (m, p, b) => 0; await call('PATCH', 'pt_orderBook', patch);" }]).length === 1);
ok('…and one that PUTs pt_masters/recipe', unrouted([{ name: 'y.js', text: "call('PUT', 'pt_masters/recipe', v)" }]).length === 1);
ok('…and a DELETE with method: written out', unrouted([{ name: 'z.js', text: "https.request(u, { method: \"DELETE\" }); // pt_cuttingData" }]).length === 1);
ok('the same script using the helper passes',
  unrouted([{ name: 'x.js', text: "const NW = require('./_noted-write.js'); await call(...NW.noted('PATCH', 'pt_orderBook', patch));" }]).length === 0);
ok('a write to a register that is not synced passes', unrouted([{ name: 'a.js', text: "call('PATCH', 'pt_accLedger', patch)" }]).length === 0);
ok('a script that only reads a synced register passes', unrouted([{ name: 'b.js', text: "get('pt_orderBook'); if (c.method === 'PUT' && /pt_qcChecks/.test(c.url)) n++;" }]).length === 0);

console.log('== every script in tests/probes and tests/patches ==');
const files = [];
['probes', 'patches'].forEach(d => fs.readdirSync(path.join(__dirname, d)).filter(f => f.endsWith('.js')).forEach(f => files.push({ name: d + '/' + f, text: fs.readFileSync(path.join(__dirname, d, f), 'utf8') })));
const bad = unrouted(files);
ok('none writes a synced register without _noted-write.js (' + files.length + ' scripts looked at)', bad.length === 0, bad.join(', '));
const routed = files.filter(f => /_noted-write/.test(f.text) && f.name !== 'probes/_noted-write.js');
ok('the scripts that were routed still use it', routed.length >= 16, String(routed.length));
const sample = files.find(f => f.name === 'probes/sync-sample.js').text, reset = files.find(f => f.name === 'probes/sync-reset.js').text;
ok('sync-sample.js never writes (no write verb, no request with a method)', !writes(sample) && !/\bPOST\b/.test(sample) && !/method\s*:/.test(sample) && !/\.request\(/.test(sample) && !/NW\.call|noted\(/.test(sample));
ok('sync-reset.js writes only pt_sync/_reset/<register>', /'pt_sync\/_reset\/' \+ reg/.test(reset) && !/pt_orderBook|pt_masterDB/.test(reset.replace(/e\.g\. node sync-reset\.js pt_orderBook/, '')));

console.log('== the helper ==');
const stamp = { '.sv': 'timestamp' };
let r = NW.noted('PATCH', 'pt_masterDB', { m1: { sku: 'A' }, 'm2/color': 'Red' });
ok('a PATCH of two rows leaves two notes, in the same request', r[0] === 'PATCH' && r[1] === '' && JSON.stringify(r[2]['pt_sync/pt_masterDB/m1']) === JSON.stringify(stamp)
  && !!r[2]['pt_sync/pt_masterDB/m2'] && r[2]['pt_masterDB/m1'].sku === 'A' && r[2]['pt_masterDB/m2/color'] === 'Red', JSON.stringify(r));
r = NW.noted('PATCH', '', { 'pt_orderBook/a/qty': 5, 'pt_audit/2026-11/x': { n: 1 } });
ok('a root PATCH: the noted row gets a note, the audit line does not', !!r[2]['pt_sync/pt_orderBook/a'] && Object.keys(r[2]).filter(k => k.startsWith('pt_sync')).length === 1);
r = NW.noted('PUT', 'pt_masters/accessories', [1, 2]);
ok('a PUT of one row becomes one PATCH carrying its note', r[0] === 'PATCH' && r[1] === '' && r[2]['pt_masters/accessories'].length === 2 && !!r[2]['pt_sync/pt_masters/accessories']);
r = NW.noted('DELETE', 'pt_qcChecks/k1');
ok('a DELETE of a row writes null and a note', r[0] === 'PATCH' && r[2]['pt_qcChecks/k1'] === null && !!r[2]['pt_sync/pt_qcChecks/k1']);
r = NW.noted('PUT', 'pt_orderBook', { a: 1 });
ok('a whole-register write leaves a reset line, not row notes', !!r[2]['pt_sync/_reset/pt_orderBook'] && !Object.keys(r[2]).some(k => k.startsWith('pt_sync/pt_orderBook/')));
r = NW.noted('PATCH', 'pt_accLedger', { a: 1 });
ok('a register that is not synced is sent unchanged', r[0] === 'PATCH' && r[1] === 'pt_accLedger' && JSON.stringify(r[2]) === '{"a":1}');
r = NW.noted('GET', 'pt_orderBook');
ok('a read is never touched', r[0] === 'GET' && r[1] === 'pt_orderBook');
ok('the eight registers are the app\'s own list', (() => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'history.js'), 'utf8');
  const m = h.match(/const PT_SYNC_NODES = new Set\(\[([\s\S]*?)\]\)/); const app = m ? m[1].match(/pt_\w+/g) : [];
  return app.length === 8 && app.every(n => NW.SYNC_NODES.includes(n));
})());

console.log('== sync-sample sorts each row into one cause ==');
const c = x => SAMPLE.sortCause(x);
ok('connected under 60 s: the stale copy', /^STALE COPY/.test(c({ upFor: 12, hasNote: true })));
ok('note after the copy + type difference: normalise', /^NORMALISE/.test(c({ upFor: 400, diffText: 'k1.qty number/string "5" vs "5" | note +30s vs copy', hasNote: true })));
ok('no note + a history line: the note was lost', /^NOTE LOST/.test(c({ upFor: 400, hasNote: false, hasAudit: true })));
ok('no note + no history line: an outside writer', /^OUTSIDE WRITER/.test(c({ upFor: 400, hasNote: false, hasAudit: false })));
ok('anything else is said to be unsorted, not guessed', /^UNSORTED/.test(c({ upFor: 400, diffText: 'k1.qty number/number "5" vs "6" | note +30s vs copy', hasNote: true })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
