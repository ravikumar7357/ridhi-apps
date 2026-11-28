/* TEETH for tests/fba-lists-test.js: break the FBA list rules on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-fba-lists.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const L = 'inventory/fba-lists.js', D = 'inventory/fg-change-remove.js';
const breaks = {
  'on everywhere': ["return typeof window !== 'undefined' && !!window.__TEST_ERP;", 'return true;'],
  'no store shares needed': ['if (!fgaOn()) return false;', ''],
  "'0' ignored": ["if (v === '0') return false;", ''],
  'switch not asked': ['!fblOn() ? FBL_OFF :', 'false ? FBL_OFF :'],
  'anybody may': ["(fbaCan() ? '' : FBL_NOT_TEAM)", "''"],
  'shipped lists keep pieces': ["['open', 'packed', 'shipping'];", "['open', 'packed', 'shipping', 'shipped'];"],
  'packed lists keep nothing': ["['open', 'packed', 'shipping'];", "['open'];"],
  'no cap': ["return want.qty <= cap ? ''", "return true ? ''"],
  'releases do not count': ['fblShare(want, book) + fgiReleased(want.sku)', 'fblShare(want, book)'],
  'other lists do not limit': ['Math.max(0, fgiOf(want.sku).current - kept)', 'fgiOf(want.sku).current'],
  'any store share': ['fgiHoldNode(), book, [want.store])', 'fgiHoldNode(), book, SHP_HOLD_STORES)'],
  'old figures pass': ["if (old) return { err: 'Nothing was saved — ' + old };", ''],
  'part pieces listed': ['!Number.isInteger(qty) || qty < 1', 'qty < 1'],
  'a second tap saves again': ['if (earlier) return', 'if (false) return'],
  'a different list taken as saved': ['return ptSame(fblAsked(earlier), fblAsked(rec)) ?', 'return true ?'],
  'no retry': ["if (answer !== 'changed') return answer;", "return answer === 'changed' ? 'x' : answer;"],
  'blind write': ['changed = !!(await ptCas(FBL_PATH, seen, next));', 'await ptPatch({ [FBL_PATH]: next });'],
  'releases not recorded': ['{ released: used }', '{}'],
  'repeat not checked': ['if (repeat && !fapMayApprove()) return', 'if (false) return'],
  'repeat approval not recorded': ['{ repeatBy: ME.email }', '{}'],
  'approval left off the movement': ['line.repeatBy ? { fbaRepeatBy: line.repeatBy } : {}', '{}'],
  'overpacking': ['counts[key] > line.qty', 'false'],
  'unknown SKU packed': ['if (!line) return { err:', 'if (!line) continue; if (false) return { err:'],
  'always packed': ["? 'packed' : 'open';", "|| true ? 'packed' : 'open';"],
  'packing writes blind': ["if (await ptCas(FBL_PATH + '/' + id, open, next)) return FBL_MOVED;\n    fblKeep",
    "await ptPatch({ [FBL_PATH + '/' + id]: next });\n    fblKeep"],
  'unpacked ships': ["if (!['packed', 'shipping'].includes(open.status))", 'if (false)'],
  'ship over packed': ['n > fgiNum(line.packed)', 'false'],
  'default ships nothing packed': [': fgiNum(line.packed);', ': 0;'],
  'no shipment id': ["if (!shipment) return", 'if (false) return'],
  'a live claim is taken over': ["if (open.status === 'shipping' && fblClaimLive(open)) return { err:", 'if (false) return { err:'],
  'a stuck claim stays': ['Date.now() - Date.parse(l.claimAt) <= FBL_CLAIM_MS', 'true'],
  'second tap complains': ["return { err: already ? '' :", "return { err: false ? '' :"],
  'random movement ids': ['`FBA-${id}-${n + 1}`', "'FBA-' + Math.random()"],
  'not accepted': ['fbaAcceptedAt: head.at, fbaAcceptedBy: ME.email,', ''],
  'read as sheet history': ["const FBL_SOURCE = 'fba list';", "const FBL_SOURCE = 'sheet list';"],
  'no stock check': ["if (short) return { err:", 'if (false) return { err:'],
  'failed ship stays claimed': ['await fblUnclaim(id, taken.claim, taken.was); return', 'return'],
  'releases not given back on ship': ['const kept = await fblGiveBack(back);', "const kept = '';"],
  'no listing alert': ["await lstAlertFor(sku, 'FBA', pieces);", ';'],
  'anyone cancels': ['if (!(ME.admin || open.by === ME.email))', 'if (false)'],
  'admin cannot cancel': ['ME.admin || open.by === ME.email', 'open.by === ME.email'],
  'cancel keeps releases': ['const kept = await fblGiveBack(used);', "const kept = '';"],
  'undo after a return': ['return returned ? { err:', 'return false ? { err:'],
  'returned count ignored': ['rows.find(r => fgiNum(r.fbaReturned) > 0)', 'undefined'],
  'undo keeps the movements': ["ids.forEach(rowId => { patch['pt_fgiLedger/' + rowId] = null; });", ''],
  'undo allots the unshipped again': ['{ qty: l.shipped, packed: l.shipped }', '{}'],
  'undo without the tab': ['if (!fbaCan()) return FBL_NOT_TEAM;', ''],
  'undo asks the switch': ['if (!fbaCan()) return FBL_NOT_TEAM;', 'if (fblBlocked()) return fblBlocked();'],
  'claim held 2 minutes': ['const FBL_CLAIM_MS = 5 * 60 * 1000;', 'const FBL_CLAIM_MS = 2 * 60 * 1000;'],
  'a taken-over claim still saves': ['return ptSame(now, claim) && ', 'return '],
  'a slow claim still saves': [' && Date.now() - Date.parse(claim.claimAt) <= FBL_SEND_BY_MS', ''],
  'ship not re-checked': ["if (lost) return { err: 'Not shipped — ' + lost };", ''],
  'undo not re-checked': ["if (lost) return 'The shipment was not undone — ' + lost;", ''],
  'a lost answer reads as failed': ['let done;', 'throw e; let done;'],
  'any failure reads as saved': ["if (!done || done.status !== 'shipped' || done.shippedAt !== head.at) throw e;", ''],
  'unreadable reads as saved': ['return `The shipment may or may not be saved', "return ''; return `"],
  'unclaim minds field order': ['ptCas(path, now, back)', 'ptCas(path, claim, back)'],
  'alert failure fails the ship': ["try { await lstAlertFor(sku, 'FBA', pieces); }", "await lstAlertFor(sku, 'FBA', pieces); try {}"],
  'a list movement is deleted': [D, 'if (fgiOnFbaList(r)) {', 'if (false) {'],
  'its return goes with it': [D, ' || fgiOnFbaList(byId.get(r.linkedFbaId))', ''],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-fba-lists-' + process.pid + '.js');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
for (const [name, broken] of Object.entries(breaks)) {
  const [file, from, to] = broken.length === 3 ? broken : [L, ...broken];   // the list rules, unless another file is named
  const src = read(file);
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'fba-lists-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }), timeout: 60000 });
  const caught = run.status !== 0 && /passed, \d+ failed|suite stopped/.test(String(run.stdout));
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' +(Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
