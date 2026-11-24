/* TEETH for tests/page-parts-test.js: break the page-parts code on purpose, four ways, and the suite must fail every time.
 *   node tests/teeth/teeth-page-parts.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'page-parts.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'a person exception is ignored': s => s.replace("roleOff.forEach(key => { if (person[key] !== true) hidden.add(key); });", "roleOff.forEach(key => hidden.add(key));")
    .replace("Object.keys(person).forEach(key => { if (person[key] === false && apxKnown(key)) hidden.add(key); });", ''),
  'an admin is not exempt': s => s.replace('if (isAdmin) return new Set();', ''),
  'a failed read hides instead of shows': s => s.replace("    return null;\n  } finally", "    return { roleDoc: { roles: {} }, personDoc: { parts: { 'so.col.buyer': false } } };\n  } finally"),
  'a bad key is not filtered': s => s.replace('.filter(key => APX_KEYS.has(key) && APX_KEY_OK.test(key))', ''),
  'a pop-up off does not hide its children': s => s.replace('return apxWithChildren(hidden);', 'return hidden;'),
  'a pop-up off leaves the buttons that open it': s => s.replace("  hidden.forEach(key => (APX_OPENERS[key] || []).forEach(opener => all.add(opener)));\n", ''),
  'a preview uses stale switches instead of the ones handed over': s => s.replace('apxEffective(roleDoc, null, roleKey, false) : new Set();', 'apxEffective(APX.roleDoc, null, roleKey, false) : new Set();'),
  'the switch off still hides': s => s.replace('return !APX.on || !APX.hidden.has(key);', 'return !APX.hidden.has(key);').replace('function apxOn(key) { return !APX.on || !APX.hidden.has(key); }', 'function apxOn(key) { return !APX.hidden.has(key); }')
    .replace("if (!APX.on) { apxStyle(); return; }", ''),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(require('os').tmpdir(), 'teeth-page-parts.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'page-parts-test.js')], { env: Object.assign({}, process.env, { PP_SRC: tmp }), encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
