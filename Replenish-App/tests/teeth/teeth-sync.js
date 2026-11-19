/* TEETH for tests/sync-test.js: break the change register on purpose, four ways, and the suite must fail every time.
 *   node tests/teeth/teeth-sync.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'history.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'ptPatch forgets to note': s => s.replace("  if (!merged) ptSyncNote(Object.keys(updates || {}), false);\n", ''),
  'the note is awaited and can throw': s => s.replace('ptAuditWrite(u).catch(() => {});', 'return ptAuditWrite(u);')
    .replace("  if (!merged) ptSyncNote([path], true);\n  if (typeof oalAfterSave === 'function') oalAfterSave(path, value, 'put');", "  if (!merged) await ptSyncNote([path], true);\n  if (typeof oalAfterSave === 'function') oalAfterSave(path, value, 'put');"),
  'the note goes before the save': s => s.replace("  auditLog('patch', updates || {});\n  if (!merged) ptSyncNote(Object.keys(updates || {}), false);\n", "  auditLog('patch', updates || {});\n")
    .replace("  ptLiveWrote(Object.keys(updates || {}));\n  let r = null, merged = false;", "  ptSyncNote(Object.keys(updates || {}), false);\n  ptLiveWrote(Object.keys(updates || {}));\n  let r = null, merged = false;"),
  /* Step 4b: the one-request save */
  'ptPatch drops the merge (note always sent after)': s => s.replace("r = await saSend(Object.assign({}, updates, nl));", "r = await saSend(Object.assign({}, updates));"),
  'ptPatch sends the note after the save as well as inside': s => s.replace("  if (!merged) ptSyncNote(Object.keys(updates || {}), false);\n", "  ptSyncNote(Object.keys(updates || {}), false);\n"),
  'the hook is given the note keys': s => s.replace("oalAfterSave('', updates, 'patch')", "oalAfterSave('', Object.assign({}, updates, nl || {}), 'patch')"),
  'ptCas takes the combined request': s => s.replace(" ptMirror('put', { [path]: next });\n  ptSyncNote([path], true);", " ptMirror('put', { [path]: next });\n  saNoteLines([path], true, null);"),
  'a refused combined request is not retried': s => s.replace("if (r.status === 403) { saRefused(Object.keys(updates || {}), 403); r = null; } else merged = true;", "merged = true;"),
  'a field write is noted as the field, not the row': s => s.replace("out['pt_sync/' + seg[0] + '/' + key]", "out['pt_sync/' + seg.join('/')]"),
  'ptDelete forgets to note': s => s.replace(" ptMirror('delete', { [path]: null });\n  if (!merged) ptSyncNote([path], true);\n", " ptMirror('delete', { [path]: null });\n"),
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
