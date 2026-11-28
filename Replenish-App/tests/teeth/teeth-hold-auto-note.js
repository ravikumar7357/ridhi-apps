/* TEETH for tests/hold-auto-note-test.js: break the test website's own noting of the website-hold figure on purpose; the suite must fail every time.
 *   node tests/teeth/teeth-hold-auto-note.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const HOLD = 'inventory/fg-shop-hold.js', O = 'shopify/shopify-orders.js', FGL = 'inventory/finished-goods.js';
const breaks = {
  'noted on live too': [HOLD, "if (!shpOnTestSite() || fgiHoldState().state !== 'missing')", "if (fgiHoldState().state !== 'missing')"],
  'noted when it is there': [HOLD, "|| fgiHoldState().state !== 'missing') { SHP_HOLD_AUTO_WHY", "|| false) { SHP_HOLD_AUTO_WHY"],
  'not asked before an FBA check': [HOLD, 'const notNoted = await shpHoldNoteIfMissing();', "const notNoted = 'x';"],
  'not read back after noting': [HOLD, "if (!notNoted && fgiHoldState().state === 'missing') fgiHoldKeep(", "if (false) fgiHoldKeep("],
  'the reason is lost': [HOLD, 'try { SHP_HOLD_AUTO_WHY = await soHoldNoteFromCopy(); }', "try { SHP_HOLD_AUTO_WHY = (await soHoldNoteFromCopy(), ''); }"],
  'the refusal still sends to the tab': [HOLD, "if (state === 'missing' && SHP_HOLD_AUTO_WHY) return", "if (false) return"],
  'nothing noted when the tab opens': [HOLD, "if (await shpHoldNoteIfMissing()) return;\n  try {", "return;\n  try {"],
  'the list is not redrawn': [HOLD, "if (typeof TAB_NOW === 'undefined' || TAB_NOW === 'fgi') renderFgi();", ''],
  'switch off still notes': [HOLD, 'if (!shpHoldOn() || !shpOnTestSite()', 'if (!shpOnTestSite()'],
  'Finished Goods never asks': [FGL, "if (typeof fgiHoldNoteOnOpen === 'function') fgiHoldNoteOnOpen();", ''],
  'Finished Goods waits for it': [FGL, "if (typeof fgiHoldNoteOnOpen === 'function') fgiHoldNoteOnOpen();", "if (typeof fgiHoldNoteOnOpen === 'function') await fgiHoldNoteOnOpen();"],
  'two asks run twice': [O, 'if (!SO_HOLD_NOTING) SO_HOLD_NOTING =', 'SO_HOLD_NOTING ='],
  'UAT off is not said': [O, 'window.__UAT && !window.__UAT.on', 'false'],
  'the stock is not read first': [O, 'SHOP_STOCK_LOADED ? null : loadShopStock(), ', ''],
  'India stock is not read first': [O, 'loadShopIndia(), ptNeed', 'ptNeed'],
  'the order book is not read first': [O, ", ptNeed(PTG_ALL, { why: 'shop-hold', has: 'ob' })", ''],
  'a failed read is lost': [O, 'return SO_HOLD_NOT_NOTED + (e.message || String(e)); }', "return ''; }"],
  'the copy\'s reason is lost': [O, '  return soHoldPublishCopy();\n}', "  await soHoldPublishCopy();\n  return '';\n}"],
  'stock reasons are blurred': [O, "SHOP_INDIA_ERR ? 'India stock could not be read: ' + SHOP_INDIA_ERR", "SHOP_INDIA_ERR ? 'Amazon or India stock has not been read yet'"],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-hold-auto-' + process.pid + '.js');
for (const [name, [file, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'hold-auto-note-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
  const caught = run.status !== 0 && /passed, \d+ failed|suite stopped/.test(String(run.stdout));
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
