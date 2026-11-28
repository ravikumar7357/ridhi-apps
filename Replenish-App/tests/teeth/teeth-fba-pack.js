/* TEETH for tests/fba-pack-test.js: break the packing of FBA lists on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-fba-pack.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const CORE = ['replenishment/pack-core.js', 'PKC_SRC'], SCAN = ['replenishment/pack-scan.js', 'PKS_SRC'], PKV = ['inventory/pack-verify.js', 'PKV_SRC'];
const breaks = {
  'stock rows still written': [CORE, 'if (packFbaOn() || p.scan.fbaListId) return', 'if (false) return'],
  'a list session writes rows when off': [CORE, 'packFbaOn() || p.scan.fbaListId', 'packFbaOn()'],
  'no list needed': [CORE, 'if (!listId) return { err: PACK_NO_FBA_LIST };', 'if (!listId) return { rows: [] };'],
  'empty boxes saved': [CORE, 'if (!Object.keys(packed).length) return', 'if (false) return'],
  'a refusal ignored': [CORE, 'if (why) return { err: why };\n  if (handoverTo', 'if (handoverTo'],
  'store caps the list': [CORE, 'if (scan.fbaListId) return', 'if (false) return'],
  'anybody opens a session': [CORE, 'if (blocked) return { err: blocked };', ''],
  'a second packing list': [CORE, 'if (had.exists()) {', 'if (false) {'],
  'old quantities kept': [CORE, '{ plan: lines }', '{}'],
  'shipping lists offered': [CORE, '["open", "packed"].includes(list.status)', 'true'],
  'shipped sessions offered': [CORE, 'packFbaPackable(fblLists()[p.scan.fbaListId])', 'true'],
  'stock right still asked': [PKV, "(packFbaOn() ? fblBlocked() :", "(false ? fblBlocked() :"],
  'pkv starts from orders': [PKV, 'if (packFbaOn()) return pkvStartList', 'if (false) return pkvStartList'],
  'pkv old finish words': [PKV, "if (res.fbaList) pkvSay('good', 'Packed'", "if (false) pkvSay('good', 'Packed'"],
  'dispatch not redrawn': [PKV, 'if (res.fbaList) renderFba();', ''],
  'scan keeps orders boxes': [SCAN, 'const fromFba = byOrder && packFbaOn();', 'const fromFba = false;'],
  'scan asks no list': [SCAN, 'if (fromFba && !id && !listId) return', 'if (false) return'],
  'scan old finish card': [SCAN, 'return pksFinishFba(card, p, t, left);', ';'],
  'done offered with no list': [SCAN, 'pksFinishWire(listed);', 'pksFinishWire(true);\n  card.innerHTML += "pksDoneBtn";'],
  'scan old done message': [SCAN, 'if (res.fbaList) return pkMsg', 'if (false) return pkMsg'],
};
let survived = 0;
for (const [name, [[file, env], from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  const tmp = path.join(os.tmpdir(), 'teeth-fba-pack-' + process.pid + '.js');
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'fba-pack-test.js')], { env: Object.assign({}, process.env, { [env]: tmp }), encoding: 'utf8', timeout: 60000 });
  fs.unlinkSync(tmp);
  console.log((r.status !== 0 ? '  BITES  ' : '  MISSED ') + name);
  if (r.status === 0) survived++;
}
console.log(survived ? `\n${survived} break(s) not caught` : '\nevery break was caught');
process.exit(survived ? 1 : 0);
