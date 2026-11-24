/* PAGE PARTS — core/page-parts.js: which parts of a page a person sees (Ravi, 24 Nov 2026).
 *   node tests/page-parts-test.js            (PP_SRC=<file> to test another copy of page-parts.js; the teeth suite does)
 * What must hold: nothing set shows everything; a role switch hides; a person's own "on" beats the role's "off" and a
 * person's "off" beats a role with nothing; admins and the owner see all; an unknown key is ignored; a pop-up that is off
 * hides what is inside it; an unreadable record or a slow answer shows everything and leaves a console line; a bad key is
 * never written into the style; with the switch off nothing is read, no style is made and every part shows. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.PP_SRC || path.join(__dirname, '..', 'src', 'app', 'core', 'page-parts.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* The code run in its own scope, with a fake page, storage, console and database. o: ls (storage), host, testErp, me, docs, readDelay, readFails. */
function load(o) {
  o = o || {};
  const store = Object.assign({}, o.ls || {});
  const localStorage = { getItem: k => (k in store ? store[k] : null) };
  const warns = [];
  const consoleFake = { warn: m => warns.push(String(m)) };
  const styles = [];
  const document = { head: { appendChild: el => styles.push(el) }, getElementById: id => styles.find(s => s.id === id) || null,
    createElement: () => ({ id: '', textContent: '', remove() { styles.splice(styles.indexOf(this), 1); } }) };
  const window = o.testErp ? { __TEST_ERP: {} } : {};
  const location = { hostname: o.host || 'fabricrush-replenish.web.app' };
  const reads = [];
  const docs = o.docs || {};
  const getDoc = ref => { reads.push(ref); if (o.readFails) return Promise.reject(new Error('permission-denied'));
    const answer = { exists: () => ref in docs, data: () => docs[ref] };
    return o.readDelay ? new Promise(r => setTimeout(() => r(answer), o.readDelay)) : Promise.resolve(answer); };
  const doc = (_db, coll, id) => coll + '/' + id;
  const ME = Object.assign({ email: 'a@x.com', admin: false, accessRole: 'sales' }, o.me || {});
  const body = SRC + '\nreturn { apxSwitchOn, apxEffective, apxLoad, apxOn, apxStyleText, apxPreviewAs, PAGE_PARTS, APX_KEYS };';
  const api = new Function('localStorage', 'console', 'document', 'window', 'location', 'getDoc', 'doc', 'db', 'ME', body)(localStorage, consoleFake, document, window, location, getDoc, doc, {}, ME);
  return Object.assign(api, { warns, styles, reads });
}
const ROLES = (roleOff) => ({ v: 1, roles: { sales: roleOff } });
const eff = (roleDoc, personDoc, role, admin) => load().apxEffective(roleDoc, personDoc, role, admin);
const has = (set, k) => set.has(k);

/* ---- the rules ---- */
ok('nothing set: nothing hidden', eff(null, null, 'sales', false).size === 0);
ok('role off: hidden', has(eff(ROLES({ 'so.col.buyer': false }), null, 'sales', false), 'so.col.buyer'));
ok('role off: another role is not affected', eff(ROLES({ 'so.col.buyer': false }), null, 'ppc', false).size === 0);
ok('person true beats role off', !has(eff(ROLES({ 'so.col.buyer': false }), { parts: { 'so.col.buyer': true } }, 'sales', false), 'so.col.buyer'));
ok('person false hides a part the role leaves on', has(eff(ROLES({}), { parts: { 'so.col.buyer': false } }, 'sales', false), 'so.col.buyer'));
ok('person false with no role at all still hides', has(eff(null, { parts: { 'so.col.buyer': false } }, '', false), 'so.col.buyer'));
ok('no role: role switches do not apply', eff(ROLES({ 'so.col.buyer': false }), null, '', false).size === 0);
ok('admin and owner see all (even with their own exceptions)', eff(ROLES({ 'so.col.buyer': false }), { parts: { 'so.col.date': false } }, 'sales', true).size === 0);
const unknown = load();
ok('unknown key is ignored, with a console line', !has(unknown.apxEffective(ROLES({ 'so.nope': false }), { parts: { 'so.alsoNope': false } }, 'sales', false), 'so.nope')
  && unknown.warns.some(w => /unknown part/.test(w)) && unknown.apxEffective(ROLES({ 'so.nope': false }), null, 'sales', false).size === 0);
const kids = eff(ROLES({ 'so.dlg.order': false }), null, 'sales', false);
ok('pop-up off hides its children', has(kids, 'so.dlg.order') && has(kids, 'so.dlg.order.col.image') && has(kids, 'so.dlg.order.btn.editLine'));
ok('pop-up off does not hide a sibling pop-up', !has(kids, 'so.dlg.changeQty') && !has(kids, 'so.dlg.review.btn.approve'));
ok('a child off leaves the pop-up on', !has(eff(ROLES({ 'so.dlg.order.col.image': false }), null, 'sales', false), 'so.dlg.order'));
const OPENERS = { 'so.dlg.order': ['so.btn.open'], 'so.dlg.form': ['so.btn.new', 'so.btn.edit'], 'so.dlg.review': ['so.btn.review', 'so.btn.addMissing'],
  'so.dlg.changeQty': ['so.dlg.order.btn.changeQty'], 'so.dlg.delReqs': ['so.btn.delReqs'], 'so.dlg.qtyConfirm': ['so.btn.qtyImport'] };
Object.keys(OPENERS).forEach(dlg => ok(dlg + ' off hides the buttons that open it: ' + OPENERS[dlg].join(', '),
  OPENERS[dlg].every(k => has(eff(ROLES({ [dlg]: false }), null, 'sales', false), k))));
ok('form off hides New and Edit but not Open or Review', (() => { const h = eff(ROLES({ 'so.dlg.form': false }), null, 'sales', false); return h.has('so.btn.new') && h.has('so.btn.edit') && !h.has('so.btn.open') && !h.has('so.btn.review'); })());
ok('a person whose own exception turns the form off loses New and Edit too', has(eff(null, { parts: { 'so.dlg.form': false } }, '', false), 'so.btn.new'));
ok('a button off leaves its pop-up on', !has(eff(ROLES({ 'so.btn.new': false }), null, 'sales', false), 'so.dlg.form'));
ok('the keys Ravi listed are all there', ['so.tile.missing', 'so.flt.dates', 'so.btn.qtyImport', 'so.col.delivery', 'so.sec.backByPpc', 'so.dlg.qtyConfirm', 'so.dlg.form.col.customization'].every(k => load().APX_KEYS.has(k)));

/* ---- the switch ---- */
ok('switch: default off on the live site', load().apxSwitchOn() === false);
ok('switch: on for the test link', load({ testErp: true }).apxSwitchOn() === true);
ok('switch: on for localhost', load({ host: 'localhost' }).apxSwitchOn() === true);
ok("switch: localStorage '1' turns it on", load({ ls: { pageParts: '1' } }).apxSwitchOn() === true);
ok("switch: localStorage '0' turns it off even on localhost", load({ ls: { pageParts: '0' }, host: 'localhost' }).apxSwitchOn() === false);

/* ---- loading ---- */
const DOCS = { 'config/accessParts': { v: 1, roles: { sales: { 'so.col.buyer': false, 'so.col.date': false } } }, 'accessParts/a@x.com': { parts: { 'so.col.date': true } } };
(async () => {
  const on = load({ ls: { pageParts: '1' }, docs: DOCS });
  await on.apxLoad();
  ok('load: role off hides, person on shows', !on.apxOn('so.col.buyer') && on.apxOn('so.col.date') && on.apxOn('so.col.status'));
  ok('load: one style, with the hidden part only', on.styles.length === 1 && on.styles[0].id === 'apxStyle' && /data-part="so\.col\.buyer"/.test(on.styles[0].textContent) && !/so\.col\.date/.test(on.styles[0].textContent));

  const adm = load({ ls: { pageParts: '1' }, docs: DOCS, me: { admin: true } });
  await adm.apxLoad();
  ok('load: admin reads nothing and sees all', adm.reads.length === 0 && adm.apxOn('so.col.buyer') && adm.styles.length === 0);

  const bad = load({ ls: { pageParts: '1' }, docs: DOCS, readFails: true });
  await bad.apxLoad();
  ok('load: unreadable record shows everything, with a console line', bad.apxOn('so.col.buyer') && bad.styles.length === 0 && bad.warns.some(w => /could not read/.test(w)));

  const slow = load({ ls: { pageParts: '1' }, docs: DOCS, readDelay: 4000 });
  const t0 = Date.now(); await slow.apxLoad();
  ok('load: a slow answer shows everything within about 2.5 s, with a console line', slow.apxOn('so.col.buyer') && Date.now() - t0 < 3500 && slow.warns.some(w => /no answer/.test(w)));

  const off = load({ docs: DOCS });
  await off.apxLoad();
  ok('switch off: nothing read, no style, every part shows', off.reads.length === 0 && off.styles.length === 0 && off.apxOn('so.col.buyer'));

  const none = load({ ls: { pageParts: '1' } });
  await none.apxLoad();
  ok('load: no records saved yet shows everything', none.apxOn('so.col.buyer') && none.styles.length === 0);

  /* ---- the style ---- */
  const t = load().apxStyleText(new Set(['so.col.buyer', 'x"]{}', 'so.nope', 'SO.COL.DATE']));
  ok('a bad or unknown key is never written into the style', t === '[data-part="so.col.buyer"]{display:none!important}', JSON.stringify(t));

  /* ---- preview as a role (admin only, in memory only) ---- */
  const pre = load({ ls: { pageParts: '1' }, docs: DOCS, me: { admin: true } });
  const roleDoc = DOCS['config/accessParts'];
  await pre.apxLoad(); pre.apxPreviewAs('sales', roleDoc);
  ok('preview: the page is hidden as that role would see it', !pre.apxOn('so.col.buyer') && pre.styles.length === 1);
  pre.apxPreviewAs('sales', ROLES({ 'so.col.buyer': false, 'so.col.status': false }));
  ok('preview: a switch changed after the first preview shows in the next one', !pre.apxOn('so.col.status') && /so\.col\.status/.test(pre.styles[0].textContent));
  ok('preview: reads nothing (the editor hands over what it holds)', pre.reads.length === 0);
  pre.apxPreviewAs(null);
  ok('preview: null goes back to everything', pre.apxOn('so.col.buyer') && pre.styles.length === 0);
  const notAdmin = load({ ls: { pageParts: '1' }, docs: DOCS });
  await notAdmin.apxLoad(); const before = notAdmin.styles.length; notAdmin.apxPreviewAs('ppc', roleDoc);
  ok('preview: ignored for a non-admin', notAdmin.styles.length === before && !notAdmin.apxOn('so.col.buyer'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
