/* TEETH for tests/shop-hold-test.js: break the held-pieces rules on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-shop-hold.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const FILES = { SHP_HOLD_SRC: path.join(APP, 'inventory', 'fg-shop-hold.js'), SHP_ORDERS_SRC: path.join(APP, 'shopify', 'shopify-orders.js') };
const H = 'SHP_HOLD_SRC', O = 'SHP_ORDERS_SRC', C = 'shopify/shopify-copy.js';
/* a screen's file, by its path under src/app */
const FORM = 'inventory/fg-other-movements.js', SCAN = 'inventory/fg-scanning.js', EDIT = 'inventory/fg-corrections.js',
  CORE = 'replenishment/pack-core.js', PHONE = 'replenishment/pack-scan.js', DESK = 'inventory/pack-verify.js', LIST = 'inventory/finished-goods.js',
  DEL = 'inventory/fg-change-remove.js', UNDO = 'inventory/fba-ship-excel.js';
const breaks = {
  'sets are not turned into pieces': [H, 'fgiNum(c.sets) * fgiNum(c.perSet)', 'fgiNum(c.sets)'],
  'on for everybody': [H, 'return shpOnTestSite();\n}', 'return true;\n}'],
  'off on the test website': [H, 'return shpOnTestSite();\n}', 'return false;\n}'],
  'a reversed issue still counts': [H, ' || r.reversed === true) return;', ') return;'],
  'issued pieces are held twice': [H, 'const left = n.pieces - Math.round(issued.get(id) || 0);', 'const left = n.pieces;'],
  'one store is enough': [H, 'if (times.some(t => !t))', 'if (times.every(t => !t))'],
  'the newer store sets the age': [H, 'Math.min(...times)', 'Math.max(...times)'],
  'a release is swallowed by a need beyond the stock': [H, 'Math.max(0, have - fgiHeld(sku, hold)) + fgiReleased(sku, hold)', 'Math.max(0, have - fgiHeld(sku, hold) + fgiReleased(sku, hold))'],
  'a release gives more than the stock': [H, 'return Math.min(have, Math.max(0, have - fgiHeld(sku, hold)) + fgiReleased(sku, hold));', 'return Math.max(0, have - fgiHeld(sku, hold)) + fgiReleased(sku, hold);'],
  'an older read overwrites': [H, 'if (!(figure.at > noted.at)) return false;', ''],
  'an old figure is never refreshed': [H, 'figure.at - noted.at > SHP_HOLD_REWRITE_MS || ', ''],
  'anybody may release': [H, 'if (!(ME && ME.admin))', 'if (false)'],
  'a release is used when not needed': [H, 'let owed = w.qty - Math.max(0, w.current - fgiHeld(w.sku, hold));', 'let owed = w.qty;'],
  'a failed save keeps the release': [H, 'left: Number(r.left) + pcs,', 'left: Number(r.left),'],
  'a failed give-back is not said': [H, 'were NOT given back', 'were given back'],
  'an edit judges the whole row again': [H, 'const more = fgiNum(now.qty) - fgiNum(was.qty);', 'const more = fgiNum(now.qty);'],
  'a type change is not judged': [H, 'return [{ sku, qty: fgiNum(now.qty), current:', 'return []; [{ sku, qty: fgiNum(now.qty), current:'],
  'each line gets all the free pieces': [H, 'left.set(sku, left.get(sku) - ', 'left.set(sku, left.get(sku) - 0 * '],
  'the form does not ask': [FORM, "if (type === 'FBA' && typeof shpHoldOn === 'function' && shpHoldOn()) return", 'if (false) return'],
  'the form uses an old figure': [FORM, 'const unchecked = await fgiHoldReread();', "const unchecked = '';"],
  'the form saves past the releases': [FORM, 'const refused = await fgiFbaWrite(', "const refused = await (async (w, f) => { await f(); return ''; })("],
  'a scan is not held': [SCAN, "if (h.t === 'FBA' && typeof shpHoldOn === 'function' && shpHoldOn()) return", 'if (false) return'],
  'Save all is not held': [SCAN, "if (h.t === 'FBA' && typeof shpHoldOn === 'function' && shpHoldOn()) {", 'if (false) {'],
  'an edit is not held': [EDIT, "if (typeof shpHoldOn === 'function' && shpHoldOn()) {", 'if (false) {'],
  'Finish does not use the releases': [CORE, 'if (typeof shpHoldOn === "function" && shpHoldOn()) {', 'if (false) {'],
  'the lines are not capped': [CORE, 'return fgiHoldCap(out);', 'return out;'],
  'opening a packing screen reads nothing': [CORE, 'await fgiHoldReread();', ''],
  'the phone does not say why': [PHONE, 'why: held || (', 'why: ('],
  'the desk does not say why': [DESK, 'held ? esc(held) : ', ''],
  'no Shopify held column': [LIST, "...(holds ? ['Shopify held'] : []), ", ''],
  'everybody may release': [H, 'const fgiMayRelease = (sku, shares) => !!(ME && ME.admin) &&', 'const fgiMayRelease = (sku, shares) =>'],
  'a release is written over blindly': [H, "if (!(await ptCas(SHP_HOLD_PATH + '/releases', hold.releases, plan.next)))", "await ptCas(SHP_HOLD_PATH + '/releases', hold.releases, plan.next); if (true)"],
  'a refused save goes through': [H, "if (why) return { err: 'Nothing was saved", "if (false) return { err: 'Nothing was saved"],
  'an old figure is trusted': [H, "if (state === 'ok') return '';", "if (state !== 'missing') return '';"],
  'handled orders count': [O, '|| f.mcfDone || f.handled)', '|| f.mcfDone)'],
  'the pending sheet is ignored': [O, ' && shpSheetAllows(o);\n}\n/** The order\'s production', ';\n}\n/** The order\'s production'],
  'Amazon-fillable orders count': [O, " || soMcf(o).v === 'yes') return [];", ') return [];'],
  'a cut-off list counts as full': [O, ' && !answers[b].more', ''],
  'narrowed dates count as full': [O, 'wholeWindow && !answers', '!answers'],
  'noted with the switch off': [O, "if (typeof shpHoldOn !== 'function' || !shpHoldOn()) return;\n", ''],
  'noted before India stock is in': [O, '!SHOP_STOCK_LOADED || !SHOP_INDIA_AT ||', '!SHOP_STOCK_LOADED ||'],
  'older orders are not counted': [O, '(SHOP.holdOld || []).concat(SHOP.orders)', 'SHOP.orders'],
  'a cut-off older read counts': [O, "(a.more ? 'Shopify had more unshipped orders than one answer holds' : '')", "''"],
  'older orders asked shipped and all': [O, "end: sdToday(), open: '1' };", "end: sdToday(), open: '0' };"],
  'a clock ahead is trusted': [H, ' || times.some(t => shpHoldAhead(t, nowMs));', ';'],
  'a figure from a clock ahead blocks later reads': [H, ' || shpHoldAhead(noted.at, nowMs)) return true;', ') return true;'],
  'the copy shortcut is kept': [O, '!live && !holding && soCopyMode()', '!live && soCopyMode()'],
  'not noted is silent': [O, '  soMsg(line, true);\n', ''],
  'the order book is not asked': [O, 'read[b] = bookIn && !cut', 'read[b] = !cut'],
  'the order book counts as loaded': [O, "(prOn() ? ptRegLoaded('ob') : !!PTG.at)", 'true'],
  'live counts from the shared copy': [O, 'shpHoldOn() && shpOnTestSite();', 'shpHoldOn();'],
  'the test website waits for live Shopify': [O, 'shpHoldOn() && shpOnTestSite();', 'false;'],
  'the test website still skips the copy shortcut': [O, 'const holding = !fromCopy && ', 'const holding = '],
  'Fetch on the test website notes nothing': [O, '  if (fromCopy) soHoldPublish();\n  /* PHOTOS', '  /* PHOTOS'],
  'the copy shortcut on the test website notes nothing': [O, '    if (fromCopy) soHoldPublish();\n    return;', '    return;'],
  'the copy is noted as read now': [O, '{ at: s.at, by: ME.email,', '{ at: Date.now(), by: ME.email,'],
  'only the fully held days are counted': [O, 'soSharedDaysToRead(st, {}, floor)', 'soSharedDaysToRead(st, {}, st.filledFrom)'],
  'days older than the tab reaches are read': [O, 'soSharedDaysToRead(st, {}, floor)', "soSharedDaysToRead(st, {}, '')"],
  'a day is read every time': [O, 'if (had && had.changedAt === changedAt) return had.orders;', ''],
  'a changed day is not read again': [O, 'had && had.changedAt === changedAt', 'had'],
  'two reads at once': [O, 'if (!SO_HOLD_COPY_READING) {', 'if (true) {'],
  'a read is kept for good': [O, '.finally(() => { SO_HOLD_COPY_READING = null; })', ''],
  'a missing day counts as no orders': [O, "if (!orders) throw new Error('the shared copy lists", "if (!orders) return {}; if (0) throw new Error('the shared copy lists"],
  'a missing day is not told apart': [C, "(JSON.parse(s.data().json || '{}').orders || {}) : null;", "(JSON.parse(s.data().json || '{}').orders || {}) : {};"],
  'an unfilled store counts': [O, 'if (!st.syncedAt || !st.filledFrom)', 'if (false)'],
  'a store with no days counts': [O, 'if (!days.length) throw', 'if (false) throw'],
  'another format is read': [C, 'if (!m || m.v !== SO_COPY.ver) throw', 'if (!m) throw'],
  'CPC orders are counted as Ridhi': [O, 'Object.assign({}, o, { shopBrand: brand,', 'Object.assign({}, o, {'],
  'napkin names of the copy are not known': [O, 'soIndexNames(copyOrders);', 'soIndexNames();'],
  'screen orders are added to the copy': [O, 'const orders = copyOrders || [', 'const orders = (copyOrders && copyOrders.concat(SHOP.orders)) || ['],
  'a short copy is not said': [O, 'const short = brands.some(b => read[b].from > read.floor);', 'const short = false;'],
  'an old copy is not said': [O, 'const old = brands.some(b => Date.now() - read[b].at > SHP_HOLD_MAX_AGE_MS);', 'const old = false;'],
  'no read right is not named': [O, "e.code === 'permission-denied'", 'false'],
  'noted from the copy without the order book': [O, 'if (!soHoldBookIn()) throw', 'if (false) throw'],
  'noted from the copy before stock is in': [O, 'if (soHoldStockWhy()) return soHoldCopySay(', 'if (false) return soHoldCopySay('],
  'live accepts an old figure': [H, '(ageMs > SHP_HOLD_MAX_AGE_MS && !shpOnTestSite())', 'false'],
  'the test website still refuses an old copy': [H, '(ageMs > SHP_HOLD_MAX_AGE_MS && !shpOnTestSite())', '(ageMs > SHP_HOLD_MAX_AGE_MS)'],
  'no warning for an old copy': [H, "return shpOnTestSite() && state === 'ok' &&", "return false &&"],
  'a changed need of the same copy is not noted': [H, ' || (figure.at === noted.at && !ptSame(noted.skus || {}, figure.skus));', ';'],
  'a newer copy waits an hour': [H, 'if (shpOnTestSite()) return figure.at > noted.at', 'if (false) return figure.at > noted.at'],
  'live follows the test website rule': [H, 'if (shpOnTestSite()) return figure.at > noted.at', 'return figure.at > noted.at'],
  'the test website gets the live refusal': [H, 'if (shpOnTestSite()) return shpHoldTestAgeWhy(state);', ''],
  'deleting a return is not held': [DEL, "if (typeof shpHoldOn === 'function' && shpHoldOn()) {", 'if (false) {'],
  'undoing a part shipment is not held': [UNDO, 'fgiFbaWrite(fgiFbaReturnWants(backs), write)', "fgiFbaWrite([], write)"],
  'a return deleted with its dispatch is judged': [H, " && !gone.has(r.linkedFbaId))", ')'],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-shop-hold-' + process.pid + '.js');
for (const [name, [env, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(FILES[env] || path.join(APP, env), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'shop-hold-test.js')], { env: Object.assign({}, process.env, FILES[env] ? { [env]: tmp } : { SHP_MUT_FILE: env, SHP_MUT_SRC: tmp }) });
  const caught = run.status !== 0;
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
