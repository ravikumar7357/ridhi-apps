/* TEETH for tests/pack-core-test.js, pack-scan-test.js and pack-verify-test.js: break the shared packing rules on purpose;
 * the core suite must fail every time (the screen suites load the same file, so a core break reaches them too).
 *   node tests/teeth/teeth-pack-core.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'replenishment', 'pack-core.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'a wrong article counts as good': s => s.replace("if (!ls) return { kind: 'wrong', sku, taken: 0, parts: [] };", "if (!ls) return { kind: 'good', sku, taken: want, parts: [{ orderNo: '?', qty: want }], orderNo: '?', left: 0 };"),
  'the India Store cap is ignored': s => s.replace('left: Math.max(0, Math.min(qty, store) - got)', 'left: Math.max(0, qty - got)'),
  'a full order keeps counting': s => s.replace("if (!parts.length) {\n      const capped", "if (false) {\n      const capped"),
  'undo gives nothing back': s => s.replace("(parts || []).forEach(p => { m[p.orderNo] = Math.max(0, num(m[p.orderNo]) - num(p.qty)); if (!m[p.orderNo]) delete m[p.orderNo]; });", ''),
  'the ledger row forgets its boxes': s => s.replace('packId: p.id, boxes: r.boxes,', 'packId: p.id, boxes: [],'),
  'pieces past the orders are not dealt out': s => s.replace('if (rest > 0 && o.allot) {', 'if (false) {'),
  'Finish writes twice': s => s.replace("if ((p.scan.ledgerIds || []).length) return { rows: [], already: true };", ''),
  'the stock check is skipped': s => s.replace("if (bad) return { err: bad + ' Receive it in Finished Goods first, then Finish again.' };", ''),
  'the FBA account is not checked': s => s.replace("if (FGI_FBA_ACCOUNTS.indexOf(p.account) < 0) return", "if (false) return"),
  'a plan line is a real order': s => s.replace("if (no && no !== planNo && num(q) > 0) parts.set(no, num(q));", "if (no && num(q) > 0) parts.set(no, num(q));"),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(os.tmpdir(), 'teeth-pack-core.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'pack-core-test.js')], { env: Object.assign({}, process.env, { PKC_SRC: tmp }), encoding: 'utf8', timeout: 60000 });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
