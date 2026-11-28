/* TEETH for tests/fba-repeat-test.js: break the repeat FBA rule on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-fba-repeat.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const HOLD = 'inventory/fg-shop-hold.js';
const R = 'inventory/fg-fba-repeat.js', FORM = 'inventory/fg-other-movements.js', SCAN = 'inventory/fg-scanning.js', CORE = 'replenishment/pack-core.js', EDIT = 'inventory/fg-corrections.js', LIST = 'inventory/finished-goods.js';
const breaks = {
  'FBA lists do not close the other ways': [HOLD, 'return FGI_FBA_BY_LIST;', '{}'],
  'a shorter window': [R, 'const FAP_DAYS = 7;', 'const FAP_DAYS = 6;'],
  'a longer window': [R, 'const FAP_DAYS = 7;', 'const FAP_DAYS = 8;'],
  'UTC dates': [R, 'new Date(ms + 330 * 60000)', 'new Date(ms)'],
  'returned dispatches count': [R, "return st !== 'sheet' && open > 0 &&", "return st !== 'sheet' &&"],
  'sheet history counts': [R, "return st !== 'sheet' && open > 0 &&", 'return open > 0 &&'],
  'any SKU counts': [R, 'shpHoldKey(r.sku) !== key ||', ''],
  'any approval right': [R, 'const fapMayApprove = () => !spIsVendor() && !!(ME.admin || ME.fbaRepeatApprove);', 'const fapMayApprove = () => true;'],
  'a vendor may approve': [R, '!spIsVendor() && !!(ME.admin', '!!(ME.admin'],
  'admins may not': [R, '!!(ME.admin || ME.fbaRepeatApprove)', '!!ME.fbaRepeatApprove'],
  'Cancel goes on': [R, "return { stop: 'Nothing was saved — you pressed Cancel.' };", '{}'],
  'no limits when asking': [R, "if (why) return { stop: 'Nothing was saved — ' + why };", ''],
  'unreadable requests ignored': [R, 'const unread = await fgiStockReread() || await fapReread();', 'const unread = await fgiStockReread(); await fapReread();'],
  'the rest of a waiting list is written': [CORE, 'if (gate.held.length) return', 'if (false) return'],
  'approved pieces are asked of the stock again': [CORE, 'if (typeof fapApproved === "function" && fapApproved(p.id, r.sku)) continue;', ''],
  'an approved row is written again': [R, "(request.status === 'approved' ? out.written : out.held)", "(request.status === 'approved' ? out.fresh : out.held)"],
  'an approved id is left off the list': [CORE, 'sent.concat(gate.written).map', 'sent.map'],
  'a rejection is ignored': [R, "if (status === 'rejected') return", 'if (false) return'],
  'a deleted movement counts as written': [R, "if (status === 'approved' && !fapMovement(id))", 'if (false)'],
  'another number passes': [R, "if (fgiNum(qty) === row.qty) return '';", "return '';"],
  'an approved box may be taken out': [R, "if (q.status === 'approved' && fapMovement(id))", 'if (false)'],
  'a live approval is ignored on removal': [R, "if (q.status === 'approving' && !fapClaimStale(q)) return", 'if (false) return'],
  'a removed request is not withdrawn': [R, 'const kept = await fapWithdraw(earlier.removed);', "const kept = '';"],
  'a withdrawn request blocks for good': [R, "if (!request || request.status === 'withdrawn')", 'if (!request)'],
  'a waiting row is forgotten after 7 days': [R, 'const earlier = fapEarlier(rows, stem);', 'const earlier = { fresh: rows, held: [], written: [], removed: [] };'],
  'the view is offered with the switch off': [R, "$('fapOpt').disabled = !on;", "$('fapOpt').disabled = false;"],
  'a picked view stays with the switch off': [R, "if (!on && $('fgView').value === 'fbarep') $('fgView').value = 'stock';", ''],
  'the view routes with the switch off': [LIST, "if (view === 'fbarep' && typeof fapOn === 'function' && fapOn()) return fapRender();", "if (view === 'fbarep') return fapRender();"],
  'everybody waits': [R, 'return approver ? fapSelfApproved(rows, repeats) : fapHold(rows, repeats, stem);', 'return fapHold(rows, repeats, stem);'],
  'nobody waits': [R, 'return approver ? fapSelfApproved(rows, repeats) : fapHold(rows, repeats, stem);', 'return asIs;'],
  'the other SKUs wait too': [R, "return { send: rows.filter(r => !repeats.includes(r)), extra: {}, held };", 'return { send: [], extra: {}, held };'],
  'self approval not recorded': [R, 'return { send, extra, held: [] };', 'return { send, extra: {}, held: [] };'],
  'a new id every press': [R, "'FBAR-' + shpHoldKey(stem + '-' + sku)", "'FBAR-' + Math.random().toString(36).slice(2)"],
  'a changed request taken as saved': [R, "if (!had || had.status !== 'waiting' || fgiNum(had.qty) !== request.qty)", 'if (false)'],
  'scans go straight in': [SCAN, 'if (repeat) return stop(repeat);', ''],
  'Save all does not ask': [SCAN, "typeof fapScanSave === 'function' ? await fapScanSave() :", 'false ? 0 :'],
  'the scan message is dropped': [SCAN, "$('fgMsg').textContent = `${nf(repeat.handled)} repeat SKU(s) saved.` + repeat.note;", "$('fgMsg').textContent = '';"],
  'answered scans stay on the list': [R, 'rows.forEach(r => FGS.rows.delete(r.sku));', ''],
  'the form does not ask': [FORM, "type === 'FBA' && typeof fapGate === 'function' ?", 'false ?'],
  'the form writes a waiting row': [FORM, 'if (gate && !gate.send.length) {', 'if (false) {'],
  'the form drops the approval record': [FORM, "? ptPatch(Object.assign({ ['pt_fgiLedger/' + rec._id]: rec }, gate.extra)) :", "? ptPut('pt_fgiLedger/' + rec._id, rec) :"],
  'packing does not ask': [CORE, 'typeof fapGate === "function" ? await fapGate(rows, p.id) :', 'false ? 0 :'],
  'approving does not check the right': [R, "async function fapApprove(id) {\n  if (!fapMayApprove()) return FAP_NOT_APPROVER;", 'async function fapApprove(id) {'],
  'rejecting does not check the right': [R, "async function fapReject(id, reason) {\n  if (!fapMayApprove()) return FAP_NOT_APPROVER;", 'async function fapReject(id, reason) {'],
  'no fresh ledger at approval': [R, "const unread = await fgiStockReread();\n  if (unread) return unread;\n  const path", 'const path'],
  'no limits at approval': [R, "if (why) return 'Not approved — ' + why;", ''],
  'approved twice': [R, "const fapOpen = q => !!q && (q.status === 'waiting' || fapClaimStale(q));", 'const fapOpen = q => !!q;'],
  'a live approval is taken over': [R, "q.status === 'approving' && Date.now() - Date.parse(q.decidedAt) > FAP_CLAIM_MS", "q.status === 'approving'"],
  'a stuck approval stays stuck': [R, "q.status === 'approving' && Date.now() - Date.parse(q.decidedAt) > FAP_CLAIM_MS", 'false'],
  'the claim ignores others': [R, "if (await ptCas(path, was, claim)) return 'Somebody else", "await ptCas(path, was, claim); if (false) return 'Somebody else"],
  'a failed approval stays claimed': [R, 'await fapUnclaim(path, claim, was); return refused;', 'return refused;'],
  'releases are not spent': [R, "const refused = await fgiFbaWrite([{ sku: row.sku, qty: row.qty, current: fgiOf(row.sku).current }],\n    () =>", "const refused = await (async (w, f) => { await f(); return ''; })([],\n    () =>"],
  'the movement keeps the asking time': [R, 'date: fgiDmy(dTodayIndia()), createdAt: at,', 'date: fgiDmy(dTodayIndia()),'],
  'no reason needed': [R, "if (!why) return 'Say why it is rejected", "if (false) return 'Say why it is rejected"],
  'edits are free': [EDIT, "typeof fapEditRefusal === 'function' ?", 'false ?'],
  'the edited dispatch is not counted': [R, 'wants.find(x => fapRecent(x.sku, x.without).length)', 'wants.find(x => fapRecent(x.sku, x.without).length > 1)'],
  'the approver cannot edit': [R, 'if (!fapOn() || fapMayApprove()) return', 'if (!fapOn()) return'],
  'the reason is put in as HTML': [R, '${esc(q.reason)}', '${q.reason}'],
  'everybody sees Approve': [R, 'fapMayApprove() && fapOpen(q) ?', 'fapOpen(q) ?'],
  'old rejections stay on the badge': [R, ' && Date.parse(q.decidedAt) > since', ''],
  'Cancel says yes': [R, "answer(b.dataset.fap === '1');", 'answer(true);'],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-fba-repeat-' + process.pid + '.js');
for (const [name, [file, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'fba-repeat-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
  const caught = run.status !== 0 && /passed, \d+ failed|suite stopped/.test(String(run.stdout));
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
