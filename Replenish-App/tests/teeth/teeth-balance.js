/* Break the Cloth left by challan rules on purpose; tests/flow-balance-test.js must notice every one.
 * Each broken copy is written to a temp folder (BAL_DIR) — src/ is never touched. */
const fs = require('fs'), os = require('os'), path = require('path');
const { execSync } = require('child_process');
const SRC = path.join(__dirname, '..', '..', 'src', 'app', 'flow', 'flow-balance.js');
const TEST = path.join(__dirname, '..', 'flow-balance-test.js');
const good = fs.readFileSync(SRC, 'utf8');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'teeth-balance-'));

const breaks = [
  ['the waste put back still counts as used', 'Math.max(0, flowR2(cut.cut - cut.waste))', 'Math.max(0, flowR2(cut.cut))'],
  ['the newest challan is used first', 'a.first.localeCompare(b.first)', 'b.first.localeCompare(a.first)'],
  ['a line moved to another printer is kept', 'l.ruffleOnly || flowChMoved(c, l) ||', 'l.ruffleOnly ||'],
  ['used more than came is not flagged', 'rest > 0 ? rest : 0', '0'],
  ['red only after 30 days', 'r.days > FLOW_BAL_LYING_DAYS', 'r.days > 30'],
  ['a pieces line counts nothing issued', '(s ? +s.issuedNet || 0 : recvAll)', '(s ? 0 : recvAll)'],
  ['every line is Leftover, even one still to cut', "past ? 'leftover' : 'waiting'", "'leftover'"],
  ['pieces cut with no metres count as cloth left over', "noMetres ? 'nometres' : ", ''],
  ['pieces issued over say "Used", as if cloth', "r.unit === 'pcs' ? 'Issued' : 'Used'", "'Used'"],
  ['pieces waiting are sent to Cutting, not Job Work', "r.unit === 'pcs' ? 'issue' : 'cut'", "'cut'"],
  ['Receive is offered when the printer owes nothing', "(r.owedBy ? btn(", "(true ? btn("],
  ['the What to do drop-down does not filter', "!FLOW_BAL.todo || FLOW_BAL.todo === 'every' || r.todo === FLOW_BAL.todo", "true"],
  ['the Printer drop-down does not filter', "(!FLOW_BAL.printer || r.printer === FLOW_BAL.printer)", "true"],
  ['used-up lines show without asking', "(FLOW_BAL.todo === 'every' || r.todo)", "true"],
  ['worked out again on every draw', "if (c.out && c.ch === FLOW.ch", "if (false && c.ch === FLOW.ch"],
  ['kept after the challans change', "c.ch === FLOW.ch && c.cut === cut", "c.cut === cut"],
  ['Over 7 days only does not filter', "(!FLOW_BAL.late || flowBalLying(r))", "true"],
];

let allBit = true;
for (const [what, from, to] of breaks) {
  if (good.split(from).length !== 2) { console.log('SKIP (anchor) ' + what); allBit = false; continue; }
  fs.writeFileSync(path.join(DIR, 'flow-balance.js'), good.replace(from, () => to));
  let out = '';
  try { out = execSync('node "' + TEST + '"', { encoding: 'utf8', env: Object.assign({}, process.env, { BAL_DIR: DIR }) }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const m = out.match(/(\d+) passed, (\d+) failed/), bit = m ? Number(m[2]) > 0 : false;
  if (!bit) allBit = false;
  console.log((bit ? 'BIT  ' : 'MISS ') + what + '  (' + (m ? m[0] : 'no summary') + ')');
}
fs.rmSync(DIR, { recursive: true, force: true });
console.log(allBit ? '\nall bit' : '\nSOMETHING DID NOT BITE');
process.exit(allBit ? 0 : 1);
