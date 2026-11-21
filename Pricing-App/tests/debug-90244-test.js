/* window.debug90244() (src/app/listing/debug-90244.js) — the ERROR 90244 read-only check, over stubs.
 *   node tests/debug-90244-test.js
 * Checks: it counts the 90244 listings of both brands, finds Listing History rows that changed unit_count, the history and the
 * backend send log of the SKUs asked, Amazon's current unit_count — and that it only ever READS (lfix history / get), never sends. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'debug-90244.js'), 'utf8');

function setup(over) {
  const calls = [], loaded = [];
  const ctx = Object.assign({
    console: { log() {}, table() {} }, window: {},
    IML: { CPC: { items: [{ sku: 'C1', iss: [{ s: 'E', c: '90244', m: 'Ounce', a: ['unit_count'] }] }] } },
    imListLoad: async b => { loaded.push(b); ctx.IML[b] = { at: '2026-11-22 08:00', items: [
      { sku: 'RTC14', asin: 'B01', psku: 'RTCP', iss: [{ s: 'E', c: '90244', m: "We can't accept the Ounce you entered for Unit Count", a: ['unit_count'] }, { s: 'W', c: '18320', m: 'pic' }] },
      { sku: 'RTC75-6060', asin: 'B02', iss: [{ s: 'E', c: '90244', m: "We can't accept the Ounce you entered for Unit Count", a: ['unit_count'] }] },
      { sku: 'OK1', asin: 'B03', iss: [] }] }; },
    LH: { rows: null, loading: false },
    lhLoad: async () => { ctx.LH.rows = [
      { at: Date.parse('2026-11-18T10:00:00Z'), sku: 'RTC14', brand: 'SP', screen: 'Fix all titles', field: 'Title', attr: 'item_name', old: 'a', new: 'b', result: 'accepted', name: 'Vansh' },
      { at: Date.parse('2026-11-19T10:00:00Z'), sku: 'X9', brand: 'SP', screen: 'Listing Errors', field: 'Unit Count', attr: 'unit_count', old: '4 Ounce', new: '1 Count', result: 'accepted', name: 'Ravi' }]; },
    baCall: async p => {
      calls.push(p);
      if (p.lfix === 'history') return { ok: true, rows: p.sku === 'RTC14' ? [{ at: '2026-11-18T10:00:01Z', by: 'v@x', brand: 'SP', sku: 'RTC14', paths: ['replace /attributes/item_name'], status: 'ACCEPTED', submissionId: 's1' }] : [] };
      if (p.lfix === 'get') return { ok: true, sku: p.sku, productType: 'TABLECLOTH', asin: 'B0' + p.sku,
        attributes: { unit_count: [{ value: 4, type: { value: 'Ounce', language_tag: 'en_US' }, marketplace_id: 'M' }] },
        issues: [{ severity: 'ERROR', code: '90244', message: "We can't accept the Ounce you entered for Unit Count" }] };
      throw new Error('unexpected call ' + JSON.stringify(p));
    },
  }, over || {});
  const fn = new Function(...Object.keys(ctx), src + '\nreturn debug90244;')(...Object.values(ctx));
  return { fn, ctx, calls, loaded };
}

(async () => {
  console.log('== debug90244() ==');
  const S = setup();
  const r = await S.fn();
  ok('loads the missing brand list (SP) through Image Manager\'s own loader, keeps CPC as it is', JSON.stringify(S.loaded) === '["SP"]', S.loaded);
  ok('counts ERROR 90244 on both brands: RTC14, RTC75-6060 (Ridhi) and C1 (CPC) — not the 18320 or a clean listing', r.errors.map(e => e.brand + ':' + e.sku).join() === 'SP:RTC14,SP:RTC75-6060,CPC:C1', r.errors);
  ok('Listing History rows that changed unit_count: the one Listing Errors send', r.unitCountSends.length === 1 && r.unitCountSends[0].sku === 'X9' && r.unitCountSends[0].screen === 'Listing Errors', r.unitCountSends);
  ok('history of RTC14 (the title send) and RTC75-6060 (none)', r.history.RTC14.length === 1 && r.history.RTC14[0].attr === 'item_name' && r.history['RTC75-6060'].length === 0, r.history);
  ok('backend send log of RTC14: one send, paths "replace /attributes/item_name" (no unit_count)', r.sendLog.RTC14.length === 1 && r.sendLog.RTC14[0].paths === 'replace /attributes/item_name', r.sendLog);
  ok('Amazon now: unit_count 4 Ounce on RTC14, with its 90244', r.amazon.RTC14.unit_count[0].type.value === 'Ounce' && r.amazon.RTC14.issues90244.length === 1, r.amazon.RTC14);
  ok('ONLY reads: lfix history and lfix get, nothing else', S.calls.every(p => p.lfix === 'history' || p.lfix === 'get') && S.calls.length === 4, S.calls);
  ok('no problems reported', r.problems.length === 0, r.problems);
  const T = setup();
  const r2 = await T.fn({ skus: ['RTC14'], amazon: false });
  ok('{ amazon: false } skips the Amazon read; skus can be given', T.calls.every(p => p.lfix === 'history') && Object.keys(r2.amazon).length === 0 && Object.keys(r2.history).join() === 'RTC14', T.calls);
  const U = setup({ baCall: async () => { throw new Error('Backend not configured'); } });
  const r3 = await U.fn();
  ok('a failing read is reported, the rest still runs', r3.errors.length === 3 && r3.problems.length === 4 && /Backend not configured/.test(r3.problems[0]), r3.problems);
  ok('exposed on window', typeof S.ctx.window.debug90244 === 'function');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
