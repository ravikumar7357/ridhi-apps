/* WHICH PROJECTION TO LOOK AT (Ravi, 25 Nov: "jo hath se projection add kiya h usko dekhna chahta hu ya nahi, ya only season ke according, ya flat").
 *   node tests/proj-view-test.js
 * replForecast and its season helpers are cut out of src/app/core/multi-select-filter.js and run with a SKU that has a typed Proj and a
 * season. What must hold: the select has four views; "typed by hand" uses the typed number (as before), with season or flat for the rest;
 * "hidden" uses the calculated number even where one was typed, and the typed number stays saved; the view is remembered; a typed number
 * cannot be entered while hidden; the forecast cache is rebuilt when the view changes. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const MS = rd('src/app/core/multi-select-filter.js'), RP = rd('src/app/replenishment/replenishment.js'), RT = rd('src/app/replenishment/revenue-target.js'), IX = rd('src/index.html');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')); } };
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };

const CODE = [line(MS, 'const FC_SEASON_MIN ='), cut(MS, 'projOvrOf'), cut(MS, 'fcSeasonBase'), cut(MS, 'fcSeasonOf'), cut(MS, 'replForecast'),
  line(RP, 'const fcViewSet ='), line(RP, 'const fcViewOf =')].join('\n');
function run(view, ovr) {
  return new Function('PROJ_OVR', 'isStopped', 'awdArrivalIdx', 'view',
    'var FC_SEASON = true, FC_HAND = true;\n' + CODE + '\nfcViewSet(view);\nreturn { f: replForecast(R, PLAN), season: FC_SEASON, hand: FC_HAND, back: fcViewOf() };'
      .replace('R, PLAN', JSON.stringify(R) + ', ' + JSON.stringify(PLAN)))(ovr, () => false, () => -1, view);
}
/* 10 a day; last year the 90 days sold 900 (10 a day) and January sold 620 (20 a day) -> season x2 for January */
const lym = [620, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const R = { sku: 'S1', avgSale: 10, last30: 300, last90: 900, lyw90: 900, lyw30: 300, lym, warehouse: 0, inbReceiving: 0, awdAvail: 0, rec: {} };
const PLAN = [{ key: '2027-01', y: 2027, m: 0, days: 31, dim: 31, label: "Jan '27", recCol: '' }];
const OVR = { 'S1|2027-01': 111 };

const v1 = run('1', OVR), v0 = run('0', OVR), vs = run('s', OVR), vf = run('f', OVR);
ok('typed by hand, else season: the typed 111 is used', v1.f[0].proj === 111 && v1.f[0].manual === true && v1.season && v1.hand, JSON.stringify(v1.f[0]));
ok('typed by hand, else flat: the typed 111 is used', v0.f[0].proj === 111 && !v0.season && v0.hand);
ok('season only: the calculated 620 (10 a day x 31 x season 2), not the typed 111', vs.f[0].proj === 620 && vs.f[0].manual === false && vs.season && !vs.hand, JSON.stringify(vs.f[0]));
ok('flat only: 310 (10 a day x 31), no season, not the typed 111', vf.f[0].proj === 310 && vf.f[0].manual === false && !vf.season && !vf.hand, JSON.stringify(vf.f[0]));
ok('a SKU with nothing typed: season 620 / flat 310 in the "typed by hand" views too', run('1', {}).f[0].proj === 620 && run('0', {}).f[0].proj === 310);
ok('the typed number is not touched by looking (still 111 in the store)', OVR['S1|2027-01'] === 111);
ok('each view reads back as itself, so it is remembered as chosen', ['1', '0', 's', 'f'].every(v => run(v, OVR).back === v));
ok('an old saved choice still works: "1" = with season, "0" = flat, both with the typed numbers', v1.season && v1.hand && !v0.season && v0.hand);

ok('the select has the four views', ['<option value="1">Proj: typed by hand, else season</option>', '<option value="0">Proj: typed by hand, else flat</option>',
  '<option value="s">Proj: season only (hand-typed hidden)</option>', '<option value="f">Proj: flat only (hand-typed hidden)</option>'].every(o => IX.includes(o)));
ok('the choice is kept in this browser (repl_season)', /localStorage\.setItem\('repl_season', fcViewOf\(\)\)/.test(RP));
ok('a Proj cannot be typed while the typed numbers are hidden - it says so', /if \(!FC_HAND\) \{ rMsg\('Hand-typed projections are hidden in this view/.test(RP));
ok('the forecast is worked out again when the view changes (cache signature carries it)', /\(FC_SEASON \? 's' : 'f'\) \+ \(FC_HAND \? 'h' : 'n'\)/.test(RT));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
