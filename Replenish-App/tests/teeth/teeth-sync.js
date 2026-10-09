/* TEETH for tests/sync-test.js: break the change register on purpose, four ways, and the suite must fail every time.
 *   node tests/teeth/teeth-sync.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'history.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'ptPatch forgets to note': s => s.replace("  ptSyncNote(Object.keys(updates || {}), false);\n", ''),
  'the note is awaited and can throw': s => s.replace('ptAuditWrite(u).catch(() => {});', 'return ptAuditWrite(u);')
    .replace("  ptSyncNote([path], true);\n  return out;", "  await ptSyncNote([path], true);\n  return out;"),
  'the note goes before the save': s => s.replace("  auditLog('patch', updates || {});\n  ptSyncNote(Object.keys(updates || {}), false);\n", "  auditLog('patch', updates || {});\n")
    .replace("  ptLiveWrote(Object.keys(updates || {}));\n  const r = await fetch(`${PT_URL}/.json`", "  ptSyncNote(Object.keys(updates || {}), false);\n  ptLiveWrote(Object.keys(updates || {}));\n  const r = await fetch(`${PT_URL}/.json`"),
  'a field write is noted as the field, not the row': s => s.replace("out['pt_sync/' + seg[0] + '/' + key]", "out['pt_sync/' + seg.join('/')]"),
  'ptDelete forgets to note': s => s.replace("  auditLog('delete', { [path]: null });\n  ptSyncNote([path], true);\n", "  auditLog('delete', { [path]: null });\n"),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(require('os').tmpdir(), 'teeth-sync-history.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'sync-test.js')], { env: Object.assign({}, process.env, { SYNC_SRC: tmp }), encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
