/* TEETH for tests/delta-test.js: break the shadow (core/delta-sync.js) on purpose; the suite must fail every time.
 *   node tests/teeth/teeth-delta.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'delta-sync.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'deletes are not applied': s => s.replace('if (x.v === null) delete R[k]; else R[k] = x.v;', 'if (x.v !== null) R[k] = x.v;'),
  'the key check is skipped': s => s.replace("info.addedOutside = [...there].filter(k => !(k in R)).length;", 'info.addedOutside = 0;'),
  'a mismatch is called a race': s => s.replace('if (ts && ts >= startedAt - DELTA.marginMs) race++; else mism.push(k);', 'race++;'),
  'the whole register is downloaded for the truth': s => s.replace('const F = deltaLiveNow(node);', "const F = (await deltaRead(node)).v;"),
  'it writes its copy back into the register': s => s.replace("await deltaCopyPut(db, node, { uid, mark, v: F || {}, at: Date.now() });",
    "await deltaCopyPut(db, node, { uid, mark, v: F || {}, at: Date.now() }); await fetch(`${PT_URL}/${node}.json`, { method: 'PUT', body: JSON.stringify(F) });"),
  'it runs on every load, not once': s => s.replace('    DELTA.done = true;              // once a page session', '    DELTA.done = false;'),
  'the copy of another account is used': s => s.replace("if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') r.mode = 'nocopy';", "if (!copy || typeof copy.mark !== 'number') r.mode = 'nocopy';"),
  'a failure escapes': s => s.replace("} catch (e) { r.mode = (r.mode || '') + '+error'; r.err = deltaErr(e); }", '} finally { }'),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(os.tmpdir(), 'teeth-delta-sync.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'delta-test.js')], { env: Object.assign({}, process.env, { DELTA_SRC: tmp }), encoding: 'utf8', timeout: 60000 });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
