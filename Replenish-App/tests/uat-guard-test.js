/* THE UAT PAGE (Ravi, 21 Nov: live data, "any change in it does not go on live or any other platform", reset all or from a time).
 * Part 1 pins the rules in tests/uat-guard.js: what a screen sees is live + the tester's changes, a Firebase save becomes the
 * right changes, server values are worked out, and reset keeps exactly the changes up to the chosen moment (India time).
 * Part 2 builds the real test ERP into a folder of its own and checks the safety wiring of the UAT page AND that the test link
 * is still the test link. Made-up SKUs, POs and people only.
 *   node tests/uat-guard-test.js
 *   UAT_GUARD_FILE=<a broken copy> node tests/uat-guard-test.js   (the teeth check: a broken copy must fail) */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const FILE = process.env.UAT_GUARD_FILE ? path.resolve(process.env.UAT_GUARD_FILE) : path.join(__dirname, 'uat-guard.js');
const U = require(FILE);
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the business, in its own words ---- */
let clock = Date.parse('2026-11-21T04:30:00Z');   // 10:00 India
const at = () => new Date(clock).toISOString();
const later = mins => { clock += mins * 60000; };
let gn = 0;
const save = (method, base, body) => {           // one save on the UAT page, as the journal keeps it
  const g = 'g' + (++gn), made = U.changesOfSave(method, base, body, () => 'NEWID' + gn);
  return made.changes.map(c => ({ k: c.k, p: c.p, v: c.v, t: at(), g, who: 'tester@example.test', screen: 'gdesk', what: method + ' ' + base, auto: false }));
};
const liveOrders = () => ({ O1: { sku: 'SKU-A', status: 'open', qty: 10 }, O2: { sku: 'SKU-B', status: 'pending', qty: 4 }, O3: { sku: 'SKU-A', status: 'pending', qty: 6 } });

console.log('== what a screen sees: live + your changes ==');
{
  const live = liveOrders();
  ok('no changes: live as it is', same(U.overlay('pt_orders', live, []), live));
  const ch = save('PATCH', 'pt_orders/O1', { status: 'closed' });
  const seen = U.overlay('pt_orders', live, ch);
  ok('a changed field shows', seen.O1.status === 'closed');
  ok('the rest of the record stays live', seen.O1.qty === 10 && seen.O2.status === 'pending');
  ok('the live value handed in is not changed (a screen may be showing it)', live.O1.status === 'open');
  ok('a read of one record sees the change too', U.overlay('pt_orders/O1', live.O1, ch).status === 'closed');
  ok('a read of one field sees it', U.overlay('pt_orders/O1/status', 'open', ch) === 'closed');
  ok('a read elsewhere is untouched', U.changesFor('pt_stock', ch).length === 0);
  ok('the top of the database is touched by every change', U.changesFor('', ch).length === 1);
}
{
  const live = liveOrders();
  const del = save('DELETE', 'pt_orders/O2', null);
  ok('a removed record is gone', !('O2' in U.overlay('pt_orders', live, del)));
  const all = save('PUT', 'pt_orders', null);
  ok('removing the whole register leaves nothing', U.overlay('pt_orders', live, all) === null);
  const add = save('POST', 'pt_orders', { sku: 'SKU-C', status: 'pending', qty: 1 });
  const seen = U.overlay('pt_orders', live, add);
  ok('a new record (POST) is added with its new id', seen['NEWID' + gn] && seen['NEWID' + gn].sku === 'SKU-C');
  const cover = save('PUT', 'pt_orders/O3', { sku: 'SKU-A', status: 'done', qty: 6 });
  ok('a record put whole replaces live\'s copy of it', U.overlay('pt_orders/O3/status', 'pending', cover) === 'done');
  const emptied = save('PATCH', 'pt_orders/O2', { sku: null, status: null, qty: null });
  ok('a record whose every field is removed goes too (as Firebase)', !('O2' in U.overlay('pt_orders', live, emptied)));
  const order = save('PATCH', 'pt_orders/O1', { status: 'a' }).concat(save('PATCH', 'pt_orders/O1', { status: 'b' }));
  ok('changes are laid on in the order they were made', U.overlay('pt_orders', live, order).O1.status === 'b');
  ok('a list (array) stays a list', Array.isArray(U.overlay('pt_list', ['x', 'y'], save('PUT', 'pt_list/1', 'z'))) && U.overlay('pt_list', ['x', 'y'], save('PUT', 'pt_list/1', 'z'))[1] === 'z');
  ok('a change on a place live does not have yet', same(U.overlay('pt_new', null, save('PUT', 'pt_new/a/b', 5)), { a: { b: 5 } }));
}

console.log('== a save becomes the right changes ==');
{
  const p = U.changesOfSave('PATCH', 'pt_po/PO1', { status: 'closed', 'closed/by': 'Accounts', note: null }, () => 'x');
  ok('PATCH: one change per field', p.changes.length === 3 && p.changes[1].p === 'pt_po/PO1/closed/by');
  ok('PATCH: a null field is a removal', p.changes[2].k === 'delete');
  ok('PATCH: answered with what was sent', same(p.answer, { status: 'closed', 'closed/by': 'Accounts', note: null }));
  const root = U.changesOfSave('PATCH', '', { 'pt_a/x': 1, 'pt_b/y': 2 }, () => 'x');
  ok('PATCH at the top (several registers at once)', root.changes.map(c => c.p).join() === 'pt_a/x,pt_b/y');
  const post = U.changesOfSave('POST', 'pt_log', { at: 1 }, () => '-NEW');
  ok('POST: a new id under the register, answered { name }', post.changes[0].p === 'pt_log/-NEW' && post.answer.name === '-NEW');
  ok('PUT null: a removal', U.changesOfSave('PUT', 'pt_a/x', null, () => 'x').changes[0].k === 'delete');
  ok('DELETE: a removal', U.changesOfSave('DELETE', 'pt_a/x', null, () => 'x').changes[0].k === 'delete');
  const book = U.changesOfSave('PATCH', '', { 'pt_sync/pt_po/PO1': 1, 'pt_syncAudit/d/1': 1, 'pt_dataMeter/x': 1, 'pt_po/PO1/s': 'ok' }, () => 'x');
  ok('Firebase bookkeeping (pt_sync, pt_syncAudit, pt_dataMeter) is never kept', book.changes.length === 1 && book.changes[0].p === 'pt_po/PO1/s');
  ok('pt_syncNotes is real data, kept', U.changesOfSave('PUT', 'pt_syncNotes/a', 1, () => 'x').changes.length === 1);
}

console.log('== server values ==');
{
  const now = Date.parse('2026-11-21T06:00:00Z');
  ok('timestamp → the time now', U.withServerValues({ at: { '.sv': 'timestamp' }, n: 1 }, now, null).at === now);
  ok('increment adds to what is there', U.withServerValues({ '.sv': { increment: 3 } }, now, 7) === 10);
  ok('increment on nothing starts from 0', U.withServerValues({ '.sv': { increment: 3 } }, now, null) === 3);
  ok('increment inside a group uses that place\'s value', U.withServerValues({ count: { '.sv': { increment: 1 } } }, now, { count: 41 }).count === 42);
  ok('a save with no server value is left alone', U.hasServerValue({ a: 1 }) === false && U.hasServerValue({ a: { '.sv': 'timestamp' } }) === true);
  ok('only an increment needs the value already there', U.needsCurrent({ a: { '.sv': 'timestamp' } }) === false && U.needsCurrent({ a: { '.sv': { increment: 1 } } }) === true);
}

console.log('== a read that asks a question, answered here ==');
{
  const params = q => new URLSearchParams(q);
  const live = liveOrders();
  const q1 = U.questionOf(params('orderBy=%22status%22&equalTo=%22pending%22'));
  ok('child equal to (pending badges)', Object.keys(U.answerQuestion(live, q1)).join() === 'O2,O3');
  const changed = U.overlay('pt_orders', live, save('PATCH', 'pt_orders/O2', { status: 'closed' }));
  ok('…a record you closed drops out of "pending"', Object.keys(U.answerQuestion(changed, q1)).join() === 'O3');
  const q2 = U.questionOf(params('orderBy=%22%24key%22&limitToLast=2'));
  ok('newest 2 by key (history)', Object.keys(U.answerQuestion(live, q2)).join() === 'O2,O3');
  const q3 = U.questionOf(params('orderBy=%22sku%22&equalTo=%22SKU-A%22'));
  ok('by SKU (master lookup)', Object.keys(U.answerQuestion(live, q3)).join() === 'O1,O3');
  const q4 = U.questionOf(params('orderBy=%22%24value%22&startAt=5'));
  ok('by value from a number', Object.keys(U.answerQuestion({ a: 3, b: 5, c: 9 }, q4)).join() === 'b,c');
  ok('shallow: keys only', same(U.answerQuestion(live, U.questionOf(params('shallow=true'))), { O1: true, O2: true, O3: true }));
  ok('keys in Firebase order: whole numbers first, by size, then text', ['10', 'a', '9', '-1', 'B'].sort(U.compareKeys).join() === '-1,9,10,B,a');
  ok('values in Firebase order: nothing, false, true, numbers, text, groups', [{}, 'a', 2, true, false, null].sort(U.compareValues).map(v => JSON.stringify(v)).join() === 'null,false,true,2,"a",{}');
  ok('no question: the value as it is', same(U.answerQuestion(live, {}), live));
}

console.log('== compare-and-set sees the same thing the screen saw ==');
{
  ok('same data in another key order', U.sameData({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 }));
  ok('a changed field is not the same', !U.sameData({ a: 1 }, { a: 2 }));
  ok('nothing and null are the same', U.sameData(null, undefined));
  ok('an extra field is not the same', !U.sameData({ a: 1 }, { a: 1, b: 2 }));
}

console.log('== reset: all, after a time, back to a restore point ==');
{
  clock = Date.parse('2026-11-21T04:30:00Z');            // 10:00 India
  const a = save('PATCH', 'pt_po/PO1', { status: 'closed' }); later(30);   // 10:00
  const point = at();                                                      // 10:30 "before approval test"
  const b = save('PATCH', 'pt_po/PO1', { status: 'open' }); later(1);      // 10:30, same moment as the point
  const c = save('PATCH', 'pt_po/PO2', { status: 'closed' });              // 10:31
  const all = a.concat(b, c);
  ok('undo after a restore point keeps what was made up to it (the same second included)', U.changesUpTo(all, point).length === 2);
  ok('…and drops what came after', !U.changesUpTo(all, point).some(x => x.p === 'pt_po/PO2/status'));
  ok('the screen then shows the moment of the point', U.overlay('pt_po', { PO1: { status: 'open' }, PO2: { status: 'open' } }, U.changesUpTo(all, point)).PO2.status === 'open');
  ok('undo after a time before everything keeps nothing', U.changesUpTo(all, '2026-11-21T00:00:00.000Z').length === 0);
  ok('India time typed on the page → UTC', U.indiaToUtcIso('2026-11-21T10:30') === '2026-11-21T05:00:00.000Z');
  ok('India midnight is the evening before in UTC', U.indiaToUtcIso('2026-11-22T00:00') === '2026-11-21T18:30:00.000Z');
  ok('a time with seconds', U.indiaToUtcIso('2026-11-21T10:30:15') === '2026-11-21T05:00:15.000Z');
  ok('a half-typed time is no time', U.indiaToUtcIso('2026-11-21') === null && U.indiaToUtcIso('') === null);
  const saves = U.savesOf(all);
  ok('your changes list: one line per save, newest first', saves.length === 3 && saves[0].what === 'PATCH pt_po/PO2');
  const multi = U.savesOf(save('PATCH', '', { 'pt_a/x': 1, 'pt_b/y': 2 }));
  ok('a save that wrote two places is one line with 2 values', multi.length === 1 && multi[0].n === 2);
  ok('an empty list has no lines', U.savesOf([]).length === 0);
}

console.log('== the built pages (a real build, in a folder of its own) ==');
{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uat-build-'));
  let built = true, why = '';
  try { cp.execFileSync(process.execPath, [path.join(__dirname, 'build-test-erp.js')], { env: Object.assign({}, process.env, { TEST_ERP_OUT: out }), stdio: 'pipe' }); }
  catch (e) { built = false; why = String(e.stderr || e.message).slice(0, 300); }
  ok('the test ERP builds, the Test page with UAT mode included', built, why);
  if (built) {
    /* ONE TEST PAGE (24 Nov): replenish/ reads ERP data, saving off, with a UAT mode switch; uat/ opens it in UAT mode */
    const test = fs.readFileSync(path.join(out, 'replenish', 'index.html'), 'utf8');
    const sell = fs.readFileSync(path.join(out, 'sellora', 'index.html'), 'utf8');
    const front = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    const head = test.slice(0, test.search(/<title[\s>]/i));
    const flagAt = head.indexOf('__TEST_ERP_SB_PAGE = true'), layerAt = head.indexOf('UAT GUARD (Ravi'), guardAt = head.indexOf('/* TEST ERP GUARD —');
    ok('Test: the ERP-data flag, then the UAT layer, then the guard, all before the page', flagAt >= 0 && flagAt < layerAt && layerAt < guardAt);
    ok('Test: ERP data is never saved to (test saves off)', /testSaves: false/.test(test) && test.indexOf('await __sbFsSave(') < 0);
    ok('Test: the UAT layer takes database requests only in UAT mode', /var uatOn = !!\(window\.__UAT && window\.__UAT\.on\);/.test(test) && /if \(uatOn && \/firebasedatabase/.test(test));
    ok('Test: in UAT mode "live" is ERP data, not Firebase', /var live = window\.__TEST_ERP\.sbOn \? function \(u\) \{ return sbRtdb\(String\(u\), origFetch\); \}/.test(test) && /window\.__UAT\.write\(url, method, init, live\)/.test(test));
    ok('Test: Firestore saves go to the UAT layer (kept on the PC in UAT mode, refused when off)', (test.match(/await __uatFsSave\(/g) || []).length >= 2 && /const deleteDoc = async ref => __uatFsSave/.test(test));
    ok('Test: Firestore reads are ERP data + your changes', /const s = await __sbGetDocRaw\(ref\); await window\.__UAT\.ready; return window\.__UAT\.fsDoc\(ref, s\)/.test(test)
      && /docs = window\.__UAT\.fsDocs\(col, \{ docs \}\)\.docs/.test(test) && /window\.__UAT\.fsWatch\(ref, next, err, __sbWatchRaw\)/.test(test));
    ok('Test: UAT mode is off unless this browser turned it on', test.indexOf("ON = window.localStorage.getItem(MODE_KEY) === '1'") >= 0 && test.indexOf('if (!U.on) return Promise.reject(') >= 0);
    ok('Test: no live Firebase connection', test.indexOf("import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js')") < 0 && test.indexOf('const ptLiveable = node => false &&') >= 0);
    ok('Test: the live mirror is off', /const MIR = \{\r?\n\s*on: false && /.test(test));
    ok('Test: Reset sits next to Sign out', test.indexOf('<button id="uatResetBtn"') >= 0 && test.indexOf('<button id="uatResetBtn"') < test.indexOf('<button id="logoutBtn"'));
    ok('Test: the tab says Test', test.indexOf('<title>R-one · Test</title>') >= 0);
    const redirect = fs.readFileSync(path.join(out, 'uat', 'index.html'), 'utf8');
    ok('uat/ opens the Test page with UAT mode on', /localStorage\.setItem\('uat:r1UatMode', '1'\)/.test(redirect) && /location\.replace\('\.\.\/replenish\/'/.test(redirect) && redirect.indexOf('UAT GUARD') < 0);
    ok('Sellora: reads ERP data, test saves off, no UAT layer', sell.indexOf('__TEST_ERP_SB_PAGE = true') >= 0 && /testSaves: false/.test(sell) && sell.indexOf('UAT GUARD (Ravi') < 0);
    ok('the front page: one Test card with UAT mode, no separate UAT card, no copier', front.indexOf('href="replenish/"') >= 0 && /UAT mode/.test(front) && front.indexOf('href="uat/"') < 0 && front.indexOf('copier/') < 0);
    ok('no copier page', !fs.existsSync(path.join(out, 'copier')));
  }
  fs.rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
