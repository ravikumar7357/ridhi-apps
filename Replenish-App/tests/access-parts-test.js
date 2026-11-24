/* ACCESS · PARTS OF A PAGE — core/access-parts.js: the section of the Access page that switches parts of a page on or off.
 *   node tests/access-parts-test.js            (AP_SRC=<file> to test another copy of access-parts.js; the teeth suite does)
 * What must hold: nothing is drawn when the switch is off or for a person who is neither admin nor Access viewer; one click is
 * ONE merge write of exactly one switch (role: config/accessParts; person: accessParts/<email>); switching back on, or "role
 * default", writes the remove marker instead of a value; a viewer or non-admin is refused before any write; a failed save says
 * "Not saved: <reason>. Try again." and puts the switch back; the control is disabled while saving; an unreadable record shows
 * a clear message and no switches; names and emails go in as text, never as HTML; the preview asks the page-parts code. */
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const CORE = path.join(__dirname, '..', 'src', 'app', 'core');
const PARTS_SRC = read(path.join(CORE, 'page-parts.js'));
const SRC = read(process.env.AP_SRC || path.join(CORE, 'access-parts.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* A tiny page: elements that keep their children, text, listeners and attributes. */
function makeElement(tag) {
  const el = { tag, id: '', className: '', textContent: '', value: '', checked: false, disabled: false, type: '', children: [], parent: null, attrs: {}, handlers: {} };
  el.appendChild = kid => { kid.parent = el; el.children.push(kid); return kid; };
  el.replaceChildren = (...kids) => { el.children = []; kids.forEach(el.appendChild); };
  el.setAttribute = (k, v) => { el.attrs[k] = v; };
  el.addEventListener = (type, fn) => { (el.handlers[type] = el.handlers[type] || []).push(fn); };
  el.remove = () => { if (el.parent) el.parent.children = el.parent.children.filter(k => k !== el); };
  return el;
}
const walk = (el, fn) => { fn(el); el.children.forEach(k => walk(k, fn)); };
const findAll = (el, test) => { const out = []; walk(el, k => { if (test(k)) out.push(k); }); return out; };
const textOf = el => { let s = ''; walk(el, k => { s += k.textContent + ' '; }); return s; };
/* Fire an event and wait for every handler it started. */
const fire = (el, type) => Promise.all((el.handlers[type] || []).map(fn => fn()));

/* The code run in its own scope. o: ls, me, saveFails, readFails, docs, noDeleteField, people. */
function load(o) {
  o = o || {};
  const store = Object.assign({ pageParts: '1' }, o.ls || {});
  const localStorage = { getItem: k => (k in store ? store[k] : null) };
  const warns = [];
  const head = makeElement('head'), body = makeElement('body'), pane = makeElement('div');
  pane.id = 'paneAccess'; body.appendChild(pane);
  const document = { head, createElement: makeElement,
    getElementById: id => [head, body].map(top => findAll(top, k => k.id === id)[0]).find(Boolean) || null };
  const writes = [], reads = [], seenDisabled = [];
  const docs = o.docs || {};
  const getDoc = ref => { reads.push(ref.path); if (o.readFails) return Promise.reject({ code: 'permission-denied' });
    return Promise.resolve({ exists: () => ref.path in docs, data: () => docs[ref.path] }); };
  const doc = (_db, coll, id) => ({ path: coll + '/' + id });
  const fsSetDoc = (ref, data, opts) => { seenDisabled.push(o.watch ? o.watch() : null); writes.push({ path: ref.path, data, opts });
    return o.saveFails ? Promise.reject({ code: 'permission-denied' }) : Promise.resolve(); };
  const ME = Object.assign({ email: 'ravi@x.com', admin: true, accessView: false }, o.me || {});
  const ACX_ROLEDEFS = [{ key: 'corp', name: 'Corp', groups: [{ name: 'g', roles: [
    { key: 'owneradmin', name: 'Owner', boxes: { admin: true } }, { key: 'sales', name: 'Sales team', boxes: { tabs: ['so'] } }] }] }];
  const ACX_ROLES_DOC = { roles: { shopteam: { custom: { name: 'Shop <b>team</b>' } } } };
  const DEL = { removeMarker: true };
  const deleteField = o.noDeleteField ? undefined : () => DEL;
  const names = 'localStorage, console, document, window, location, getDoc, doc, db, ME, fsSetDoc, serverTimestamp, deleteField, ACX_ROLEDEFS, ACX_ROLES_DOC';
  const code = PARTS_SRC + '\n' + SRC + '\nreturn { acpMount, apxLoad, ACP };';
  const api = new Function(names, code)(localStorage, { warn: m => warns.push(String(m)) }, document, {}, { hostname: 'fabricrush-replenish.web.app' },
    getDoc, doc, {}, ME, fsSetDoc, () => ({ ts: true }), deleteField, ACX_ROLEDEFS, ACX_ROLES_DOC);
  return Object.assign(api, { ACX_ROLES_DOC, pane, head, writes, reads, warns, DEL, ME, seenDisabled, document });
}
const PEOPLE = [{ email: 'Anil@x.com', accessRole: 'sales' }, { email: '<img src=x onerror=alert(1)>@x.com', accessRole: 'sales' }];
const root = t => t.pane.children[0];
const roleBoxes = t => findAll(root(t), k => k.tag === 'input' && k.attrs['data-part-key']);
const personSelects = t => findAll(root(t), k => k.tag === 'select' && k.attrs['data-part-key']);
const selects = t => findAll(root(t), k => k.tag === 'select' && !k.attrs['data-part-key']);   // page, role, person
const status = t => t.document.getElementById('acp-status').textContent;
const boxFor = (t, key) => roleBoxes(t).find(b => b.attrs['data-part-key'] === key);
const choiceFor = (t, key) => personSelects(t).find(b => b.attrs['data-part-key'] === key);
const keysOf = o => Object.keys(o).sort().join(',');
async function pickPerson(t, email) { const person = selects(t)[2]; person.value = email; await fire(person, 'change'); }

(async () => {
  /* ---- who sees it ---- */
  const off = load({ ls: { pageParts: '0' } }); await off.acpMount(PEOPLE);
  ok('switch off: nothing drawn, nothing read', off.pane.children.length === 0 && off.reads.length === 0);
  const other = load({ me: { admin: false, accessView: false } }); await other.acpMount(PEOPLE);
  ok('neither admin nor Access viewer: nothing drawn', other.pane.children.length === 0);
  const admin = load(); await admin.acpMount(PEOPLE);
  ok('admin: drawn once, under the Access pane', admin.pane.children.length === 1 && root(admin).id === 'acp-root');
  await admin.acpMount(PEOPLE);
  ok('mounted again: still one section', admin.pane.children.length === 1);
  const gone = load(); await gone.acpMount(PEOPLE); gone.ME.admin = false; await gone.acpMount(PEOPLE);
  ok('rights taken away: the section is removed', gone.pane.children.length === 0);

  /* ---- what it shows ---- */
  const text = textOf(root(admin));
  ok('shows the page name, the group names and the business names of the parts', /Sales Orders/.test(text) && /Table columns/.test(text) && /Column: Raised by/.test(text) && /Tile: Missing from the order book/.test(text));
  ok('shows the two notes', /shows the next time that person opens or reloads the ERP/.test(text) && /Hiding is not security/.test(text) && /this browser only/i.test(text));
  ok('a part with a need shows a warning', /Warning: Approvers cannot approve without it/.test(text));
  ok('roles: plan roles and roles added on the Access page, but not the Admin role', (() => { const names = findAll(selects(admin)[1], k => k.tag === 'option').map(k => k.textContent);
    return names.includes('Sales team') && names.includes('Shop <b>team</b>') && !names.includes('Owner'); })());
  const late = load(); await late.acpMount(PEOPLE);
  late.ACX_ROLES_DOC.roles.latecomer = { custom: { name: 'Late role' } };   // the Access page's saved roles arrive after this section is drawn
  await fire(selects(late)[1], 'focus');
  ok('role picker: a role saved on the Access page after the first draw appears when the picker is touched, no reload', findAll(selects(late)[1], k => k.tag === 'option').map(k => k.textContent).includes('Late role') && selects(late)[1].value === late.ACP.role);
  ok('a pop-up switch says it also hides the buttons that open it; a plain part does not', (() => { const rows = findAll(root(admin), k => k.className === 'acp-row');
    const rowOf = name => rows.find(r => textOf(r).includes(name)); return /Also hides the buttons that open it/.test(textOf(rowOf('Pop-up: New / Edit order form')))
      && !/Also hides/.test(textOf(rowOf('Column: Buyer'))); })());
  ok('every part has a role switch, on by default', roleBoxes(admin).length > 40 && roleBoxes(admin).every(b => b.checked === true));

  /* ---- one click, one write ---- */
  const first = admin.ACP.role;
  const buyer = boxFor(admin, 'so.col.buyer'); buyer.checked = false; await fire(buyer, 'change');
  const w = admin.writes;
  ok('a role switch off is ONE write', w.length === 1);
  ok('it goes to config/accessParts as a merge', w[0].path === 'config/accessParts' && w[0].opts && w[0].opts.merge === true);
  ok('it carries only that switch, with the time and the admin', keysOf(w[0].data) === 'at,by,roles' && keysOf(w[0].data.roles) === first
    && keysOf(w[0].data.roles[first]) === 'so.col.buyer' && w[0].data.roles[first]['so.col.buyer'] === false && w[0].data.by === 'ravi@x.com' && w[0].data.at.ts === true);
  ok('success says Saved and the switch stays off', status(admin) === 'Saved' && boxFor(admin, 'so.col.buyer').checked === false && buyer.disabled === false);

  buyer.checked = true; await fire(buyer, 'change');
  ok('switching back on writes the remove marker, not true', w.length === 2 && w[1].data.roles[first]['so.col.buyer'] === admin.DEL && keysOf(w[1].data.roles[first]) === 'so.col.buyer');

  const date = boxFor(admin, 'so.col.date'); date.checked = false; await fire(date, 'change');
  ok('two clicks are two writes, each with one switch', w.length === 3 && keysOf(w[2].data.roles[first]) === 'so.col.date');

  /* ---- a person ---- */
  const docs = { 'accessParts/anil@x.com': { parts: { 'so.col.date': false, 'so.nope': true } } };
  const p = load({ docs }); await p.acpMount(PEOPLE); await pickPerson(p, 'anil@x.com');
  ok('picking a person reads only that person (lower-case email)', p.reads.includes('accessParts/anil@x.com'));
  ok('shows the person\'s choices and counts only known exceptions', choiceFor(p, 'so.col.date').value === 'off' && choiceFor(p, 'so.col.buyer').value === 'default'
    && p.document.getElementById('acp-count').textContent.startsWith('1 exception'));
  const c1 = choiceFor(p, 'so.col.buyer'); c1.value = 'on'; await fire(c1, 'change');
  ok('person on: one merge write to accessParts/<email>, true', p.writes.length === 1 && p.writes[0].path === 'accessParts/anil@x.com' && p.writes[0].opts.merge === true
    && keysOf(p.writes[0].data) === 'at,by,parts' && keysOf(p.writes[0].data.parts) === 'so.col.buyer' && p.writes[0].data.parts['so.col.buyer'] === true);
  ok('the count follows the save', p.document.getElementById('acp-count').textContent.startsWith('2 exception'));
  const c2 = choiceFor(p, 'so.col.buyer'); c2.value = 'off'; await fire(c2, 'change');
  ok('person off: false', p.writes[1].data.parts['so.col.buyer'] === false);
  c2.value = 'default'; await fire(c2, 'change');
  ok('role default: the remove marker', p.writes[2].data.parts['so.col.buyer'] === p.DEL && p.document.getElementById('acp-count').textContent.startsWith('1 exception'));

  /* ---- refused before any write ---- */
  const viewer = load({ me: { admin: false, accessView: true } }); await viewer.acpMount(PEOPLE);
  ok('Access viewer: section shown, every switch disabled', roleBoxes(viewer).length > 0 && roleBoxes(viewer).every(b => b.disabled) && /View only/.test(textOf(root(viewer))));
  const vb = boxFor(viewer, 'so.col.buyer'); vb.checked = false; await fire(vb, 'change');
  ok('Access viewer who gets a click through: no write, "Not saved", switch put back', viewer.writes.length === 0 && /^Not saved: view only/.test(status(viewer)) && vb.checked === true);
  const lost = load(); await lost.acpMount(PEOPLE); lost.ME.admin = false;
  const lb = boxFor(lost, 'so.col.buyer'); lb.checked = false; await fire(lb, 'change');
  ok('rights lost while the page is open: no write', lost.writes.length === 0 && lb.checked === true && /^Not saved/.test(status(lost)));

  /* ---- failures ---- */
  const bad = load({ saveFails: true }); await bad.acpMount(PEOPLE);
  const bb = boxFor(bad, 'so.col.buyer'); bb.checked = false; await fire(bb, 'change');
  ok('a failed save says Not saved with the reason and what to do', status(bad) === 'Not saved: permission-denied. Try again.');
  ok('a failed save puts the switch back and frees it', bb.checked === true && bb.disabled === false);
  const badP = load({ saveFails: true, docs: {} }); await badP.acpMount(PEOPLE); await pickPerson(badP, 'anil@x.com');
  const bc = choiceFor(badP, 'so.col.buyer'); bc.value = 'off'; await fire(bc, 'change');
  ok('a failed person save puts the choice back', /^Not saved: permission-denied/.test(status(badP)) && bc.value === 'default');
  const noDel = load({ noDeleteField: true }); await noDel.acpMount(PEOPLE);
  const nb = boxFor(noDel, 'so.col.buyer'); nb.checked = false; await fire(nb, 'change'); nb.checked = true; await fire(nb, 'change');
  ok('no remove marker in this build: says so, writes nothing for the removal', /^Not saved: this ERP build cannot remove/.test(status(noDel)) && noDel.writes.length === 1 && nb.checked === false);
  const busy = load({ watch: () => boxFor(busy, 'so.col.buyer').disabled });
  await busy.acpMount(PEOPLE);
  const yb = boxFor(busy, 'so.col.buyer'); yb.checked = false; await fire(yb, 'change');
  ok('the control is disabled while the save runs', busy.seenDisabled[0] === true && yb.disabled === false);

  /* ---- reading fails loudly ---- */
  const unread = load({ readFails: true }); await unread.acpMount(PEOPLE);
  ok('unreadable role switches: a clear message and no switches', /could not be read \(permission-denied\)/.test(textOf(root(unread))) && roleBoxes(unread).length === 0);

  /* ---- text only ---- */
  await pickPerson(admin, '<img src=x onerror=alert(1)>@x.com');
  const people = findAll(selects(admin)[2], k => k.tag === 'option').map(k => k.textContent);
  ok('an email with markup is shown as text', people.includes('<img src=x onerror=alert(1)>@x.com') && !/innerHTML|insertAdjacentHTML|document\.write/.test(SRC));

  /* ---- preview ---- */
  const pre = load(); await pre.apxLoad(); await pre.acpMount(PEOPLE);
  ok('admin sees a preview button naming the page and the role', findAll(root(pre), k => k.tag === 'button').some(b => b.textContent === 'Preview Sales Orders as Sales team'));
  const roleDoc = { 'config/accessParts': { roles: { sales: { 'so.col.buyer': false } } } };
  const pv = load({ docs: roleDoc }); await pv.apxLoad(); await pv.acpMount(PEOPLE);
  await fire(findAll(root(pv), k => k.tag === 'button' && /^Preview/.test(k.textContent))[0], 'click');
  ok('preview as a role hides its parts in this browser, and says so', pv.head.children.length === 1 && /data-part="so\.col\.buyer"/.test(pv.head.children[0].textContent) && /This browser only; gone on reload/.test(status(pv)));
  ok('a preview writes nothing', pv.writes.length === 0);
  const status2 = boxFor(pv, 'so.col.status'); status2.checked = false; await fire(status2, 'change');
  await fire(findAll(root(pv), k => k.tag === 'button' && /^Preview/.test(k.textContent))[0], 'click');
  ok('a switch turned off after a preview is hidden in the next preview', /data-part="so\.col\.status"/.test(pv.head.children[0].textContent) && /data-part="so\.col\.buyer"/.test(pv.head.children[0].textContent));
  await fire(findAll(root(pv), k => k.tag === 'button' && k.textContent === 'Stop preview')[0], 'click');
  ok('Stop preview goes back to the full page', pv.head.children.length === 0 && findAll(root(pv), k => k.textContent === 'Stop preview').length === 0);
  ok('a viewer gets no preview button', !findAll(root(viewer), k => k.tag === 'button').length);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
