/* TEETH for tests/fba-only-test.js: reopen one way to FBA at a time and the suite must fail every time.
 *   node tests/teeth/teeth-fba-only.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const HOLD = 'inventory/fg-shop-hold.js', R = 'inventory/fg-fba-repeat.js', FORM = 'inventory/fg-other-movements.js', SCAN = 'inventory/fg-scanning.js';
const CORR = 'inventory/fg-corrections.js', EDIT = 'inventory/fg-change-remove.js', CORE = 'replenishment/pack-core.js';
const breaks = {
  'Send to FBA still offered': [FORM, ".filter(t => t !== 'FBA' || current === 'FBA' || !(typeof shpListsOn === 'function' && shpListsOn()));", ';'],
  'an FBA row loses its type': [FORM, "current === 'FBA' || ", ''],
  'the entry form note is silent': [FORM, "+ (fgiNewTypeWhy('FBA') ? ' ' + fgiNewTypeWhy('FBA') : ''),", ','],
  'the entry form asks first': [FORM, 'if (byList) return byList;\n  const sku', 'const sku'],
  'every type refused': [FORM, "(type === 'FBA' && typeof", "(typeof"],
  'scan offers every type': [SCAN, '${fgiPickTypes().map(t =>', '${Object.keys(FGI_KINDS).map(t =>'],
  'a scan passes': [SCAN, 'if (byList) return { err: byList };', ''],
  'edit offers every type': [EDIT, 'fgiPickTypes(r.txnType)', 'Object.keys(FGI_KINDS)'],
  'edit drops the row\'s own type': [EDIT, 'fgiPickTypes(r.txnType)', 'fgiPickTypes()'],
  'correction offers every type': [CORR, 'fgiPickTypes(r.txnType)', 'Object.keys(FGI_KINDS)'],
  'any correction asked': [CORR, 'if (byList) return byList;', ''],
  'every correction refused': [CORR, 'return why && fgiFbaEditWants(r, Object.assign({}, r, change)).length ? why', 'return why ? why'],
  'a new request is asked': [R, 'if (shpListsOn()) return { stop: FGI_FBA_BY_LIST };', ''],
  'old requests claimed': [R, 'if (shpListsOn()) return `${FGI_FBA_BY_LIST} ${FAP_REJECT_INSTEAD}`;', ''],
  'Approve still shown': [R, "(byList ? '' : button(", "(false ? '' : button("],
  'the list says nothing': [R, '+ (byList ? ` ${FGI_FBA_BY_LIST}', '+ (false ? ` ${FGI_FBA_BY_LIST}'],
  'edit gets the repeat advice': [R, 'fapMayApprove() || shpListsOn()) return', 'fapMayApprove()) return'],
  'the save lets it through': [HOLD, 'return FGI_FBA_BY_LIST;\n', '{}\n'],
  'returns are refused': [HOLD, '!w.list && !w.back', '!w.list'],
  'old packing says nothing of the list': [CORE, 'Tick the SKUs on Finished Goods and press Make FBA list, then', 'Then'],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-fba-only-' + process.pid + '.js');
for (const [name, [file, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'fba-only-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
  const caught = run.status !== 0 && /passed, \d+ failed|suite stopped/.test(String(run.stdout));
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
