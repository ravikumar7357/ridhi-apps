/* TEETH for tests/ppc-work-given-test.js: break the "still out" rules on purpose, and the suite must fail every time.
 *   node tests/teeth/teeth-ppc-work-given.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'core', 'ppc-one.js');
const SUITE = path.join(__dirname, '..', 'ppc-work-given-test.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const swap = (a, b) => s => s.replace(a, () => b);
const breaks = {
  'a finished vendor order is ignored': swap('if (v && v.done) return', 'if (false) return'),
  'the Received status does not finish a line': swap("o.status === 'Received' || ", ''),
  'a line received in full does not finish it': swap('(ord > 0 && Math.max(got, onOurChallans) >= ord - 0.01)', 'false'),
  'cloth from a closed challan is counted again': swap('Math.max(0, q - earlier)', 'Math.max(0, q)'),
  'a shared line is split equally': swap('(total > 0 ? q / total : 1 / ids.length)', '1 / ids.length'),
  'metres entered never reach a piece challan': swap('const own = side.get(id); if (own || !id.endsWith(\'|pcs\')) return own;', 'return side.get(id);'),
  'part entered counts as all the pieces': swap('Math.min(1, Math.max(0, metres - onMetre) / c.cloth)', '(metres > 0 ? 1 : 0)'),
  'part pieces are rounded up': swap('Math.floor(c.sent * Math.min(1, Math.max(0, metres - onMetre) / c.cloth) + 1e-6)', 'Math.ceil(c.sent * Math.min(1, Math.max(0, metres - onMetre) / c.cloth) - 1e-6)'),
  'the metres are used twice beside a metre challan': swap('Math.max(0, metres - onMetre)', 'metres'),
  'a shared cloth line forgets what each size carries': swap(" + ((id.endsWith('|m') && (onChallans.get(id.slice(0, -1) + 'pcs') || {}).cloth) || 0)", ''),
  'an order filled by metre receipts finishes the pieces too': swap('done: onMetre > 0 ? m.marked : m.done', 'done: m.done'),
  'a marked order no longer finishes the pieces': swap('done: onMetre > 0 ? m.marked : m.done', 'done: onMetre > 0 ? false : m.done'),
  'a failed read passes for read': swap(' && !VO.err', ''),
  'one finished line finishes the order line though another is open': swap('v.done = v.done && done;', 'v.done = done || (v.done && v.seen !== 1); v.seen = 1;'),
  'a part delivery is still counted as out': swap('got = onOpen(v ? v.got : 0)', 'got = 0'),
  'what the printer entered as sent is still counted as out': swap('said = onOpen(v ? v.said : 0)', 'said = 0'),
  'a cancelled order finishes cloth': swap("if (!o || o.cancelled || /cancel/i.test(String(o.status || ''))) return;\n    const u", "if (!o) return;\n    const u"),
  'a cancelled line finishes cloth': swap('if (!l || l.cancelled) return;\n      const keys', 'if (!l) return;\n      const keys'),
  'any printer\'s order finishes the cloth': swap("idOf = k => String(o.vendorCode || '') +", "idOf = k => 'RBP' +"),
  'metres and pieces are mixed': swap('const u = voUnit(o), ', "const u = 'm', "),
  'ruffle cloth is finished by the main cloth': swap("(l.ruffleOnly ? FLOW_RUF : '')", "''"),
  'not-booked cloth is not said': swap("put(b.e, b.unit, x.unbooked, 'unbooked');", ''),
  'a printer with only not-booked cloth loses its row': swap(' || p.unbooked || p.um)', ')'),
  'standing cloth is dropped': swap('flowStanding().forEach', '[].forEach'),
};
const copy = path.join(os.tmpdir(), 'teeth-ppc-work-given-' + process.pid + '.js');
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const broken = f(src);
  if (broken === src) { bad++; console.log('  FAIL the break did not apply: ' + name); continue; }
  fs.writeFileSync(copy, broken);
  const r = spawnSync(process.execPath, [SUITE], { env: Object.assign({}, process.env, { PPC_ONE: copy }), encoding: 'utf8' });
  const caught = r.status !== 0 && /^ {2}FAIL/m.test(r.stdout);
  if (!caught) bad++;
  console.log((caught ? '  PASS caught: ' : '  FAIL missed: ') + name);
}
fs.rmSync(copy, { force: true });
console.log(`\n${Object.keys(breaks).length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
