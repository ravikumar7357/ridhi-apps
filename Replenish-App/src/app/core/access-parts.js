/* ================= ACCESS · PARTS OF A PAGE (Ravi, 24 Nov 2026) =================
 * A section drawn under the Access page (#paneAccess, below #acx-root): pick a page, then switch its tiles, filters, columns,
 * buttons, sections and pop-ups on or off for a ROLE, or give one PERSON an exception (role default / on / off). What the switches
 * mean and how a page obeys them is in core/page-parts.js; this file only edits them. Plan: PAGE-PARTS-PLAN.md.
 *
 * WHO: shown only while the page-parts switch is on (apxSwitchOn). Admins change; Access viewers (ME.accessView) see it read-only;
 * everybody else never gets it. A non-admin is refused before any write is tried.
 *
 * SAVING: every click is ONE write of ONE switch, merged into the record (nothing is read first, so two admins working at once
 * cannot overwrite each other's other switches):
 *   config/accessParts   { roles: { <roleKey>: { '<key>': false } }, at, by }     role switched off; back on = field removed
 *   accessParts/<email>  { parts: { '<key>': true | false }, at, by }              person on / off; role default = field removed
 * A person's change shows the next time that person opens or reloads the ERP. Hiding is not security: the data is still in the browser.
 *
 * ERROR STRATEGY: a save fails loudly ("Not saved: <reason>. Try again.") and the switch goes back to what it was. Reading the saved
 * switches for the editor also fails loudly, with a clear message, and then no switches are drawn (a wrong picture is worse than
 * none). Nothing here throws into the rest of the page. THE DATABASE RULES for config/accessParts and accessParts/* are not live
 * yet (Ravi must OK the rules change in Pricing-App): until then every save says "Not saved" and every read says it could not read.
 *
 * PREVIEW (admin): shows a page as a role would see it, in this browser only, gone on reload; nothing is saved (apxPreviewAs).
 * Main functions: acpMount (called with the list of people when the Access page has loaded them), acpRender, acpApply. */
const ACP_STATUS_SAVED = 'Saved';
const ACP_NOTE_WHEN = 'A change shows the next time that person opens or reloads the ERP.';
const ACP_NOTE_SECURITY = 'Hiding is not security: the data is still in the browser; the database rules are the real lock.';
const ACP_NOTE_PREVIEW = 'Preview is this browser only and is gone when you reload.';
const ACP_NOTE_OPENERS = ' Also hides the buttons that open it.';
const ACP_PERSON_STATES = [['default', 'Role default'], ['on', 'On'], ['off', 'Off']];

/* What the editor holds: the chosen page / role / person, the saved switches read so far, and whether a preview is showing. */
const ACP = { people: [], page: '', role: '', person: '', roleDoc: null, personDoc: null, readError: '', personError: '', previewRole: '' };

const acpCanEdit = () => ME.admin === true;
const acpCanSee = () => apxSwitchOn() && (ME.admin === true || ME.accessView === true);
const acpReason = e => String((e && (e.code || e.message)) || e);
const acpRoleDoc = () => doc(db, 'config', 'accessParts');
const acpPersonDoc = email => doc(db, 'accessParts', String(email).toLowerCase());

/* The roles the Access page offers (its role plan plus roles added there), minus the Admin role, which always sees everything.
 * Read from the Access page's saved roles each time it is called: they arrive after this section is first drawn. */
function acpRoles() {
  const planned = ACX_ROLEDEFS.flatMap(dept => dept.groups.flatMap(group => group.roles))
    .filter(role => !(role.boxes && role.boxes.admin)).map(role => ({ key: role.key, name: role.name }));
  const saved = (ACX_ROLES_DOC && ACX_ROLES_DOC.roles) || {};
  const added = Object.keys(saved).filter(key => saved[key] && saved[key].custom && !planned.some(role => role.key === key))
    .map(key => ({ key, name: saved[key].custom.name || key }));
  return planned.concat(added);
}

/* ---- the switches as saved ---- */
const acpRoleIsOn = (role, key) => !(ACP.roleDoc && ACP.roleDoc.roles && ACP.roleDoc.roles[role] && ACP.roleDoc.roles[role][key] === false);
function acpPersonState(key) {
  const value = ACP.personDoc && ACP.personDoc.parts ? ACP.personDoc.parts[key] : undefined;
  return value === true ? 'on' : value === false ? 'off' : 'default';
}
const acpExceptionCount = () => Object.keys((ACP.personDoc && ACP.personDoc.parts) || {}).filter(key => APX_KEYS.has(key)).length;

/* ---- writing: one switch per call ---- */
const acpStamp = () => ({ at: serverTimestamp(), by: ME.email });

/** Switch one part of a role on (field removed) or off (false). One merge write. */
function acpWriteRole(role, key, on) {
  const value = on ? acpRemove() : false;
  return fsSetDoc(acpRoleDoc(), Object.assign({ roles: { [role]: { [key]: value } } }, acpStamp()), { merge: true });
}

/** Give one person an exception for one part: 'on', 'off', or 'default' (field removed). One merge write. */
function acpWritePerson(email, key, state) {
  const value = state === 'default' ? acpRemove() : state === 'on';
  return fsSetDoc(acpPersonDoc(email), Object.assign({ parts: { [key]: value } }, acpStamp()), { merge: true });
}

/* The "remove this field" marker. It comes from the Firestore import in core/setup.js; if that build lacks it, say so loudly. */
function acpRemove() {
  if (typeof deleteField !== 'function') throw new Error('this ERP build cannot remove a switch yet (deleteField is not loaded)');
  return deleteField();
}

/** Run one save for one control: refuse non-admins first, disable the control while saving, say Saved or Not saved, and put the
 *  control back (restore) when the save failed. Returns true when saved. */
async function acpApply(control, write, restore) {
  if (!acpCanEdit()) { acpSay('Not saved: view only, only an admin can change these. Try again as an admin.'); restore(); return false; }
  control.disabled = true;
  try { await write(); }
  catch (e) { acpSay('Not saved: ' + acpReason(e) + '. Try again.'); restore(); return false; }
  finally { control.disabled = false; }
  acpSay(ACP_STATUS_SAVED);
  return true;
}

/* A role switch was clicked: save it, then remember it (a new record, the old one is not changed). */
async function acpOnRoleSwitch(control, key) {
  const role = ACP.role, on = control.checked;
  const saved = await acpApply(control, () => acpWriteRole(role, key, on), () => { control.checked = !on; });
  if (!saved) return;
  const roles = Object.assign({}, ACP.roleDoc && ACP.roleDoc.roles);
  const offKeys = Object.assign({}, roles[role]);
  if (on) delete offKeys[key]; else offKeys[key] = false;
  roles[role] = offKeys;
  ACP.roleDoc = Object.assign({}, ACP.roleDoc, { roles });
  acpDrawCount();
}

/* A person's choice was changed: save it, then remember it. */
async function acpOnPersonChoice(control, key) {
  const email = ACP.person, state = control.value, before = acpPersonState(key);
  const saved = await acpApply(control, () => acpWritePerson(email, key, state), () => { control.value = before; });
  if (!saved) return;
  const parts = Object.assign({}, ACP.personDoc && ACP.personDoc.parts);
  if (state === 'default') delete parts[key]; else parts[key] = state === 'on';
  ACP.personDoc = Object.assign({}, ACP.personDoc, { parts });
  acpDrawCount();
}

/* ---- reading, for the editor ---- */
async function acpLoadRoleDoc() {
  try { const snap = await getDoc(acpRoleDoc()); ACP.roleDoc = snap.exists() ? snap.data() : null; ACP.readError = ''; }
  catch (e) { ACP.roleDoc = null; ACP.readError = 'The role switches could not be read (' + acpReason(e) + '), so none are shown. Try again in a moment.'; }
}
async function acpLoadPersonDoc(email) {
  try {
    const snap = await getDoc(acpPersonDoc(email));
    if (ACP.person !== email) return;   // somebody else was picked while this was loading
    ACP.personDoc = snap.exists() ? snap.data() : null; ACP.personError = '';
  } catch (e) {
    if (ACP.person !== email) return;
    ACP.personDoc = null; ACP.personError = 'The exceptions for this person could not be read (' + acpReason(e) + '), so none are shown. Try again in a moment.';
  }
}

/** The Access page has loaded its people (rows of { email, accessRole }): draw the section, or remove it when it is not for this person. */
async function acpMount(rows) {
  const old = document.getElementById('acp-root');
  if (!acpCanSee()) { if (old) old.remove(); return; }
  ACP.people = (rows || []).map(row => ({ email: String(row.email || '').toLowerCase(), role: row.accessRole || '' })).filter(p => p.email);
  if (!ACP.page) ACP.page = Object.keys(PAGE_PARTS)[0];
  const pane = document.getElementById('paneAccess');
  if (!pane) { console.warn('[access parts] the Access pane is not on the page: parts section not drawn'); return; }
  if (!old) { const root = acpEl('div', '', 'acx'); root.id = 'acp-root'; pane.appendChild(root); }
  await acpLoadRoleDoc();
  acpRender();
}

/* ---- drawing (text only, never HTML) ---- */
function acpEl(tag, text, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}
const acpKids = (parent, kids) => { kids.forEach(kid => parent.appendChild(kid)); return parent; };

function acpSay(text) { const el = document.getElementById('acp-status'); if (el) el.textContent = text; }

/* The person's exception count, redrawn without redrawing the lists. */
const acpCountText = () => (ACP.person ? acpExceptionCount() + ' exception(s) for this person' : '');
function acpDrawCount() {
  const el = document.getElementById('acp-count');
  if (el) el.textContent = acpCountText();
}

function acpRender() {
  const root = document.getElementById('acp-root');
  if (!root) return;
  const status = acpEl('div', '', 'muted'); status.id = 'acp-status'; status.setAttribute('role', 'status');
  const head = acpKids(acpEl('div', '', 'card-head'), [acpKids(acpEl('div'), [acpEl('h2', 'Parts of a page'),
    acpEl('p', ACP_NOTE_WHEN, 'muted'), acpEl('p', ACP_NOTE_SECURITY, 'muted'),
    acpEl('p', acpCanEdit() ? ACP_NOTE_PREVIEW : 'View only: only an admin can change these.', 'muted')])]);
  const body = ACP.readError ? acpEl('div', ACP.readError, 'callout cannot') : acpKids(acpEl('div'), [acpPagePicker(), acpRoleCard(), acpPersonCard()]);
  root.replaceChildren(acpKids(acpEl('div', '', 'card'), [head, acpKids(acpEl('div'), [body, status])]));
}

function acpFillOptions(select, options, value) {
  select.replaceChildren(...options.map(([val, name]) => { const option = acpEl('option', name); option.value = val; return option; }));
  select.value = value;
}
function acpSelect(options, value, onChange) {
  const select = acpEl('select');
  acpFillOptions(select, options, value);
  select.addEventListener('change', () => onChange(select.value, select));
  return select;
}
const acpLabelled = (label, control) => acpKids(acpEl('label', label + ' ', 'muted'), [control]);

function acpPagePicker() {
  const pages = Object.keys(PAGE_PARTS).map(key => [key, PAGE_PARTS[key].name]);
  return acpLabelled('Page', acpSelect(pages, ACP.page, page => { ACP.page = page; acpRender(); }));
}

/* The parts of the chosen page, grouped as PAGE_PARTS groups them; makeControl(part) gives the switch for one part. */
function acpPartList(makeControl) {
  const list = acpEl('div');
  const groups = PAGE_PARTS[ACP.page].groups;
  Object.keys(groups).forEach(groupName => {
    list.appendChild(acpEl('h3', groupName));
    groups[groupName].forEach(part => list.appendChild(acpPartRow(part, makeControl(part))));
  });
  return list;
}
function acpPartRow(part, control) {
  const row = acpKids(acpEl('div', '', 'acp-row'), [control, acpEl('span', ' ' + part.name)]);
  if (part.need) row.appendChild(acpEl('span', ' Warning: ' + part.need + '.', 'pill limit'));
  if (APX_OPENERS[part.key]) row.appendChild(acpEl('span', ACP_NOTE_OPENERS, 'muted'));
  return row;
}

const acpRoleOptions = () => acpRoles().map(role => [role.key, role.name]);

/* The role picker follows the Access page's roles: when it is touched, roles saved there since it was drawn are added. */
function acpRolePicker() {
  const select = acpSelect(acpRoleOptions(), ACP.role, role => { ACP.role = role; acpRender(); });
  const refresh = () => {
    const options = acpRoleOptions();
    if (options.map(([key]) => key).join() !== [...select.children].map(option => option.value).join()) acpFillOptions(select, options, ACP.role);
  };
  ['focus', 'mousedown'].forEach(type => select.addEventListener(type, refresh));
  return select;
}

function acpRoleCard() {
  const roles = acpRoleOptions();
  if (!roles.some(([key]) => key === ACP.role)) ACP.role = roles.length ? roles[0][0] : '';
  const card = acpKids(acpEl('div', '', 'card'), [acpEl('h3', 'Switches for a role'), acpLabelled('Role', acpRolePicker())]);
  if (acpCanEdit()) card.appendChild(acpPreviewButtons());
  card.appendChild(acpPartList(part => acpRoleSwitch(part.key)));
  return card;
}
function acpRoleSwitch(key) {
  const box = acpEl('input'); box.type = 'checkbox'; box.checked = acpRoleIsOn(ACP.role, key); box.disabled = !acpCanEdit();
  box.setAttribute('data-part-key', key);
  box.addEventListener('change', () => acpOnRoleSwitch(box, key));
  return box;
}

function acpPersonCard() {
  const people = [['', 'Pick a person']].concat(ACP.people.map(p => [p.email, p.email]));
  const card = acpKids(acpEl('div', '', 'card'), [acpEl('h3', 'Exceptions for one person'),
    acpLabelled('Person', acpSelect(people, ACP.person, acpPickPerson))]);
  const count = acpEl('span', '', 'pill grey'); count.id = 'acp-count';
  card.appendChild(count);
  if (ACP.personError) card.appendChild(acpEl('div', ACP.personError, 'callout cannot'));
  else if (ACP.person) card.appendChild(acpPartList(part => acpPersonChoice(part.key)));
  count.textContent = acpCountText();
  return card;
}

async function acpPickPerson(email) {
  ACP.person = email; ACP.personDoc = null; ACP.personError = '';
  if (email) await acpLoadPersonDoc(email);
  if (ACP.person === email) acpRender();
}
function acpPersonChoice(key) {
  const select = acpSelect(ACP_PERSON_STATES, acpPersonState(key), (state, control) => acpOnPersonChoice(control, key));
  select.disabled = !acpCanEdit();
  select.setAttribute('data-part-key', key);
  return select;
}

/* ---- preview (admin) ---- */
function acpPreviewButtons() {
  const bar = acpEl('div');
  const roleName = (acpRoles().find(role => role.key === ACP.role) || {}).name || ACP.role;
  const start = acpEl('button', 'Preview ' + PAGE_PARTS[ACP.page].name + ' as ' + roleName, 'btn sm');
  start.addEventListener('click', () => acpPreview(ACP.role, 'Previewing as ' + roleName + '. This browser only; gone on reload.'));
  bar.appendChild(start);
  if (ACP.previewRole) {
    const stop = acpEl('button', 'Stop preview', 'btn sm ghost');
    stop.addEventListener('click', () => acpPreview('', 'Preview stopped.'));
    bar.appendChild(stop);
  }
  return bar;
}
function acpPreview(role, message) {
  apxPreviewAs(role || null, ACP.roleDoc);
  ACP.previewRole = role;
  acpRender();
  acpSay(message);
}
