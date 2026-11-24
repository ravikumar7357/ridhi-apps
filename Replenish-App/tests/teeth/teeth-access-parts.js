/* TEETH for tests/access-parts-test.js: break the Access parts section on purpose, and the suite must fail every time.
 *   node tests/teeth/teeth-access-parts.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'access-parts.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'a click writes the whole role record, not one switch': s => s.replace('{ roles: { [role]: { [key]: value } } }', '{ roles: { [role]: Object.assign({}, ACP.roleDoc && ACP.roleDoc.roles && ACP.roleDoc.roles[role], { [key]: value }), other: { x: false } } }'),
  'the write replaces the record instead of merging': s => s.replace("acpStamp()), { merge: true });\n}\n\n/** Give", "acpStamp()));\n}\n\n/** Give"),
  'switching back on writes true instead of removing the field': s => s.replace('const value = on ? acpRemove() : false;', 'const value = on;'),
  'role default writes false instead of removing the field': s => s.replace("state === 'default' ? acpRemove() : state === 'on'", "state === 'on'"),
  'a person exception goes to the role record': s => s.replace('fsSetDoc(acpPersonDoc(email),', 'fsSetDoc(acpRoleDoc(),'),
  'a non-admin is not refused before the write': s => s.replace("if (!acpCanEdit()) { acpSay(", "if (false) { acpSay("),
  'a failed save leaves the switch changed': s => s.replace("acpSay('Not saved: ' + acpReason(e) + '. Try again.'); restore(); return false;", "acpSay('Not saved: ' + acpReason(e) + '. Try again.'); return false;"),
  'the control is not disabled while saving': s => s.replace('  control.disabled = true;\n', ''),
  'an Access viewer sees nothing': s => s.replace('ME.admin === true || ME.accessView === true', 'ME.admin === true'),
  'drawn even with the switch off': s => s.replace('apxSwitchOn() && (', '('),
  'the role picker is not refreshed when touched': s => s.replace("['focus', 'mousedown']", '[]'),
  'the preview uses no current switches': s => s.replace('apxPreviewAs(role || null, ACP.roleDoc);', 'apxPreviewAs(role || null, null);'),
  'the pop-up note about its buttons is missing': s => s.replace("  if (APX_OPENERS[part.key]) row.appendChild(acpEl('span', ACP_NOTE_OPENERS, 'muted'));\n", ''),
  'the Admin role is offered': s => s.replace('.filter(role => !(role.boxes && role.boxes.admin))', ''),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(require('os').tmpdir(), 'teeth-access-parts.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'access-parts-test.js')], { env: Object.assign({}, process.env, { AP_SRC: tmp }), encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
