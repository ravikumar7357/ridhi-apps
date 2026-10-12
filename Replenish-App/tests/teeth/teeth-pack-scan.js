/* TEETH for tests/pack-scan-test.js: break Scan to pack's guards on purpose; the suite must fail every time.
 *   node tests/teeth/teeth-pack-scan.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'replenishment', 'pack-scan.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'one frame is enough (no agreement)': s => s.replace('const PKS_AGREE = 2;', 'const PKS_AGREE = 1;'),
  'a label held in view keeps counting': s => s.replace("if (!st.seen.counted && st.seen.hits >= PKS_AGREE) { st.seen.counted = true; return true; }", "if (st.seen.hits >= PKS_AGREE) { st.seen.counted = true; return true; }"),
  'an unknown code is taken as a SKU': s => s.replace("  return { sku: '', how: '' };\n}\n/** The biggest picture", "  return { sku: c, how: 'guess' };\n}\n/** The biggest picture"),
  'the empty last box is saved': s => s.replace("boxes: (PKS.p.boxes || []).filter(b => (b.items || []).length || +b.n < PKS.box)", 'boxes: (PKS.p.boxes || [])'),
  'undo takes nothing back': s => s.replace('PACK_CORE.takeFromBox(b, h.sku, h.n);', 'PACK_CORE.takeFromBox(b, h.sku, 0);'),
  'a wrong article is counted anyway': s => s.replace("if (a.kind === 'wrong') {", "if (a.kind === 'wrong' && false) {"),
  'an order that is full keeps counting': s => s.replace("if (a.kind === 'full') return", "if (a.kind === 'full' && false) return"),
  'undo forgets the orders': s => s.replace('if (h.parts && PKS.p.scan) PACK_CORE.untake(PKS.p.scan.packed, h.sku, h.parts);', ''),
  'a failed save is forgotten': s => s.replace("PKS.err = 'Not saved — ' + (e.message || e) + '. It is kept on this phone and saved with the next scan.'; PKS.dirty = true;", "PKS.err = '';"),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(os.tmpdir(), 'teeth-pack-scan.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'pack-scan-test.js')], { env: Object.assign({}, process.env, { PKS_SRC: tmp }), encoding: 'utf8', timeout: 60000 });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
