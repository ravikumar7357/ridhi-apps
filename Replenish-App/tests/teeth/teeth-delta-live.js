/* TEETH for tests/delta-live-test.js: break phase 3 (core/delta-sync.js deltaLiveOpen) on purpose; the suite must fail
 * every time.   node tests/teeth/teeth-delta-live.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'delta-sync.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'a delete that arrives is not applied': s => s.replace('if (x.v === null) delete val[k]; else val[k] = x.v;', 'if (x.v !== null) val[k] = x.v;'),
  'an older answer can overwrite a newer one': s => s.replace('if (want[k] !== my || L.delta !== \'delta\' || L.closed) return;', 'if (L.delta !== \'delta\' || L.closed) return;'),
  'a screen gets the copy itself, not a fresh object': s => s.replace('L.snap = { val: () => deltaClone(val) };', 'L.snap = { val: () => val };'),
  'a whole-register write is ignored': s => s.replace("if (v && v >= copy.mark && L.delta === 'delta') deltaToFull(L, node, 'whole register written');", 'void v;'),
  "another account's copy is used": s => s.replace("if (!copy || copy.uid !== uid || typeof copy.mark !== 'number') why = 'no copy';", "if (!copy || typeof copy.mark !== 'number') why = 'no copy';"),
  'a copy of any age is used': s => s.replace("  else if (now - copy.mark > DELTA.maxAgeMs) why = 'copy older than a day';\n", ''),
  'rows added outside the app are ignored': s => s.replace("  if (res.info.addedOutside || res.info.removedOutside) return deltaLiveFull(L, node, 'rows added or removed outside the app', idb);\n", ''),
  'a row that cannot be read is ignored': s => s.replace(".catch(() => deltaToFull(L, node, 'a changed row could not be read'));", '.catch(() => {});'),
  'switched ON as shipped': s => s.replace('  use: false, maxAgeMs', '  use: true, maxAgeMs'),
  'closing leaves listeners behind': s => s.replace('L.off = () => { L.closed = true; L.offs.forEach', 'L.off = () => { L.offs.forEach'),
  'an arrival does not move the sequence': s => s.replace("      if (x.v === null) delete val[k]; else val[k] = x.v;\n      L.evSeq = ++PT_LIVE_SEQ;\n", "      if (x.v === null) delete val[k]; else val[k] = x.v;\n"),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(os.tmpdir(), 'teeth-delta-live.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'delta-live-test.js')], { env: Object.assign({}, process.env, { DELTA_SRC: tmp }), encoding: 'utf8', timeout: 90000 });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
