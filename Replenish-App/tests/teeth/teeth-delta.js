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
  'it writes its copy back into the register': s => s.replace('r.upFor = Math.round(up / 1000);',
    "r.upFor = Math.round(up / 1000); await fetch(`${PT_URL}/${node}.json`, { method: 'PUT', body: JSON.stringify(F) });"),
  'it runs on every load, not once': s => s.replace('    DELTA.done = true;              // once a page session', '    DELTA.done = false;'),
  'the copy of another account is used': s => s.replace("if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') r.mode = 'nocopy';", "if (!copy || typeof copy.mark !== 'number') r.mode = 'nocopy';"),
  'the 60 s connected guard is removed': s => s.replace('if (up >= DELTA.minUpMs && gen === DELTA.gen) await', 'if (gen === DELTA.gen) await'),
  'a wiped copy is written back by a run under way': s => s.replace('if (up >= DELTA.minUpMs && gen === DELTA.gen) await', 'if (up >= DELTA.minUpMs) await'),
  'the shadow save carries no full-download time': s => s.replace('at: Date.now(), fullAt: nowS, keysAt: nowS }', 'at: Date.now(), keysAt: nowS }'),
  'rows past the first 20 are not reported': s => s.replace('const unchecked = Math.max(0, bad.length - 20);', 'const unchecked = 0;'),
  'more than 3 rows are explained': s => s.replace('const diff = bad.slice(0, 3).map(', 'const diff = bad.slice(0, 30).map('),
  'the diff is not cut to 40 characters': s => s.replace('JSON.stringify(x)).slice(0, 40);', 'JSON.stringify(x));'),
  'the wipe has no timeout': s => s.replace('    setTimeout(() => res(false), 3000);', ''),
  'the wipe does nothing': s => s.replace('const r = indexedDB.deleteDatabase(DELTA_DB);', 'const r = {}; setTimeout(() => res(true), 0);'),
  'a copy with no known owner or another owner is kept': s => s.replace("if (owner === em) return Promise.resolve(false);", 'return Promise.resolve(false);'),
  'the shadow reads are not counted as delta-shadow': s => s.replace("deltaRebuild(node, copy, undefined, 'delta-shadow')", "deltaRebuild(node, copy, undefined, 'delta')"),
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
