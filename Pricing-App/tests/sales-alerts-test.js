/* Sales Alerts (src/app/sales/sales-alerts.js, Sales card #3): expected sales (weekday median × season), the band (± 1.5 × MAD), when it
 * is an alert (3 low finished days, ≥ 25 %, ≥ $500/week), "waiting for data", the seasonal dip, $ at risk, severity, every root cause,
 * siblings grouped, recovery, snooze / dismiss, wins, and the Dashboard summary.
 *   node tests/sales-alerts-test.js           (prints the alerts the fixture makes at the end) */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', 'sales-alerts.js'), 'utf8');
function load(extra) {
  const store = {};
  const ctx = vm.createContext(Object.assign({
    console, Intl, Math, JSON, Number, String, Object, Array, Set, Map, Promise, Date, isFinite, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    ME: { admin: true, tabs: [], email: 'test@example.com' }, SD: { at: '', d: {} }, SD_CH: 'SP', sdToday: () => TODAY,
  }, extra || {}));
  vm.runInContext(SRC + '\n;this.__x = { AL, AL_DEF, alCompute, alMedian, alMad, alAdd, alHeroHtml, alDashOf, alFor, alCardHtml, alRowHtml, alNext, AL_HEAD, alVerify, alCsvText, AL_CHK };', ctx);
  return Object.assign(ctx.__x, { ctx, store });
}
const X = load();
const { alAdd } = X;

/* ---- the fixture: today Tue 24 Nov 2026 (PT) → the last finished day Mon 23 Nov; the last 14 days 10–23 Nov; normal weeks 13 Oct – 9 Nov ---- */
const TODAY = '2026-11-24', LAST = '2026-11-23', FROM = '2026-10-10';
const days = []; for (let d = FROM; d <= TODAY; d = alAdd(d, 1)) days.push(d);
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const shape = d => 1 + [0, -0.05, 0.03, 0.08, -0.06, 0.02, 0.04][dow(d)];          // a small weekday rhythm, the same every week
const D = {}, BR = {};
/** One ASIN: perDay $ normal, price $; mod(day) → { x: sales factor, p: price factor } for the days it changes. */
function asin(a, brand, perDay, price, mod) {
  D[a] = {}; BR[a] = brand;
  days.forEach(d => {
    const m = (mod && mod(d)) || {};
    const pr = price * (m.p || 1);
    const sales = Math.round(perDay * shape(d) * (m.x == null ? 1 : m.x) * 100) / 100;
    if (sales > 0) D[a][d] = [Math.max(1, Math.round(sales / pr)), Math.round(Math.max(1, Math.round(sales / pr)) * pr * 100) / 100];
  });
}
const inn = (a, b) => d => d >= a && d <= b;
const PARENT = {};
const kid = (p, ...as) => as.forEach(a => { PARENT[a] = p; });
// A — a real drop, 4 days, one of two children sold out (FBA 0) → Critical? ($/week at risk decides) · out of stock
asin('A1', 'SP', 300, 30, d => (inn('2026-11-20', LAST)(d) ? { x: 0 } : null)); asin('A2', 'SP', 300, 30); kid('PA', 'A1', 'A2');
// B — a small product (≈$280/week) falling 80% → never an alert
asin('B1', 'SP', 40, 20, d => (inn('2026-11-18', LAST)(d) ? { x: 0.2 } : null)); kid('PB', 'B1');
// C — only 2 low days so far → waiting for data
asin('C1', 'SP', 200, 25, d => (inn('2026-11-22', LAST)(d) ? { x: 0.4 } : null)); kid('PC', 'C1');
// E — price up 20%, units down: sales −45% for 5 days → price
asin('E1', 'SP', 250, 20, d => (inn('2026-11-19', LAST)(d) ? { x: 0.55, p: 1.2 } : null)); kid('PE', 'E1');
// F — traffic down (sessions −50%, conversion normal), 6 days → traffic
asin('F1', 'SP', 200, 25, d => (inn('2026-11-15', LAST)(d) ? { x: 0.5 } : null)); kid('PF', 'F1');
// G — conversion down (sessions the same, units −50%), 6 days → conversion
asin('G1', 'SP', 200, 25, d => (inn('2026-11-15', LAST)(d) ? { x: 0.5 } : null)); kid('PG', 'G1');
// H — ads cut 80% (and ad sales down), 4 days → ads cut
asin('H1', 'SP', 220, 22, d => (inn('2026-11-20', LAST)(d) ? { x: 0.55 } : null)); kid('PH', 'H1');
// I — a Deal Calendar deal ended 16 Nov; low 4 days → deal ended
asin('I1', 'SP', 230, 23, d => (inn('2026-11-20', LAST)(d) ? { x: 0.5 } : null)); kid('PI', 'I1');
// J — ad spend up 60% while sales fell → ads up, no sales
asin('J1', 'SP', 210, 21, d => (inn('2026-11-20', LAST)(d) ? { x: 0.55 } : null)); kid('PJ', 'J1');
// K — a drop with nothing in the data to explain it → no clear cause
asin('K1', 'SP', 190, 19, d => (inn('2026-11-20', LAST)(d) ? { x: 0.5 } : null)); kid('PK', 'K1');
// L — dropped 15–19 Nov, back to normal since 20 Nov → recovered this week (no alert)
asin('L1', 'SP', 260, 26, d => (inn('2026-11-15', '2026-11-19')(d) ? { x: 0.3 } : null)); kid('PL', 'L1');
// M — a win: +60% for 4 days, ad spend up → "ads push working"
asin('M1', 'SP', 240, 24, d => (inn('2026-11-20', LAST)(d) ? { x: 1.6 } : null)); kid('PM', 'M1');
// N — three siblings: N1 sold out, N2 price +25% (fewer units), N3 normal → grouped by cause
asin('N1', 'SP', 300, 30, d => (inn('2026-11-19', LAST)(d) ? { x: 0 } : null));
asin('N2', 'SP', 300, 30, d => (inn('2026-11-19', LAST)(d) ? { x: 0.45, p: 1.25 } : null));
asin('N3', 'SP', 300, 30); kid('PN', 'N1', 'N2', 'N3');
// O — a big product, 8 low days → Critical by days and by money
asin('O1', 'SP', 900, 30, d => (inn('2026-11-16', LAST)(d) ? { x: 0.4 } : null)); kid('PO', 'O1');
// T — a huge fall TODAY only (a part day) → nothing: today never counts
asin('T1', 'SP', 300, 30, d => (d === TODAY ? { x: 0.05 } : null)); kid('PT', 'T1');
// U — a dear size ($50) sold out beside a cheap one ($20): the parent's plain average price falls, but no price changed → out of stock only
asin('U1', 'SP', 400, 50, d => (inn('2026-11-20', LAST)(d) ? { x: 0 } : null)); asin('U2', 'SP', 300, 20); kid('PU', 'U1', 'U2');
// V — the real-data case (Pillow Cover, 24 Nov): 12% under its own normal weeks for the whole 14 days — inside "normal"; only a brand
//     season lift (×1.4) applied to it would call that "down 40% for 14 days"
asin('V1', 'SP', 700, 35, d => (d >= '2026-11-10' && d <= LAST ? { x: 0.88 } : null)); kid('PV', 'V1');
// W — irregular normal weeks (×⅓, ×1, ×1, ×3⅓ of $300): over 30% of its own normal days fall outside its range → not judged, even at −70%
asin('W1', 'SP', 300, 10, d => (inn('2026-10-13', '2026-10-19')(d) ? { x: 1 / 3 } : inn('2026-11-03', '2026-11-09')(d) ? { x: 10 / 3 } : d >= '2026-11-17' && d <= LAST ? { x: 0.3 } : null)); kid('PW', 'W1');
// X — the real-data Pillow Insert (THE WHIMSICAL CORNER, 24 Nov): normal weeks ×1.10, ×1.15, ×0.92, ×0.80 of $531/day (4,098 / 4,278 /
//     3,402 / 2,964), then −68% one week and −45% the next — with ONE normal day (22 Nov) just before the last day. The old rule
//     ("3 low days in a row ending yesterday") said "waiting: 1 low day so far".
asin('X1', 'SP', 531, 10, d => (inn('2026-10-13', '2026-10-19')(d) ? { x: 1.10 } : inn('2026-10-20', '2026-10-26')(d) ? { x: 1.15 } : inn('2026-10-27', '2026-11-02')(d) ? { x: 0.915 }
  : inn('2026-11-03', '2026-11-09')(d) ? { x: 0.80 } : inn('2026-11-10', '2026-11-16')(d) ? { x: 0.32 } : d === '2026-11-22' ? { x: 1 } : inn('2026-11-17', LAST)(d) ? { x: 0.55 } : null)); kid('PX', 'X1');
// Y — low 10 days, then back inside its range the last 2 days → recovered (not an alert)
asin('Y1', 'SP', 330, 11, d => (inn('2026-11-12', '2026-11-21')(d) ? { x: 0.5 } : null)); kid('PY', 'Y1');
// Z — only 2 low days among the last 5, scattered → no alert (not most days)
asin('Z1', 'SP', 350, 10, d => (d === '2026-11-19' || d === '2026-11-21' ? { x: 0.5 } : null)); kid('PZ', 'Z1');
// R0..R7 — down 40–60% on MOST of the last 14 days, normal days mixed in at random (never the last two together) → every one must alert
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const QLOW = {};
for (let q = 0; q < 8; q++) {
  const lowSet = new Set();
  const judged = []; for (let d = '2026-11-10'; d <= LAST; d = alAdd(d, 1)) judged.push(d);
  const nLow = 8 + Math.floor(rnd() * 6);                         // 8–13 of the 14 days low
  while (lowSet.size < nLow) lowSet.add(judged[Math.floor(rnd() * 14)]);
  if (!lowSet.has(LAST) && !lowSet.has(judged[12])) lowSet.add(LAST);
  QLOW['R' + q] = lowSet;
  const f = 0.4 + rnd() * 0.2;
  asin('R' + q, 'SP', 250 + q * 40, 10, d => (lowSet.has(d) ? { x: f } : null)); kid('PR' + q, 'R' + q);
}
// PC2 — the real-data Ridhi Block Print Pillow Cover: steady $14.8k/week, then $10.7k and $11.0k — a real drop (the brand +35% the same weeks)
asin('PC2a', 'SP', 14800 / 7.06, 1, d => (inn('2026-11-10', '2026-11-16')(d) ? { x: 10700 / 14800 } : inn('2026-11-17', LAST)(d) ? { x: 11000 / 14800 } : null)); kid('PCOVER', 'PC2a');
// UB — an uneven baseline: normal weeks ×0.9, ×0.9, ×0.9, ×1.9 (one week 65% over their average), then −50% → Needs a look
asin('UB1', 'SP', 400, 10, d => (inn('2026-11-03', '2026-11-09')(d) ? { x: 1.9 } : d >= '2026-10-13' && d <= '2026-11-02' ? { x: 0.9 } : d >= '2026-11-10' && d <= LAST ? { x: 0.45 } : null)); kid('PUB', 'UB1');
// NP — the real-data CPC Cotton print club Napkin: normal weeks 3,259 / 4,331 / 2,502 / 2,948, judged 5,522 and 8,152 — a win that showed
//      nothing. Its days vary inside each week (weights that add up to 7, turned a day each week), so the weeks are exactly those totals.
{
  const W8 = [1.2, 0.85, 1.1, 0.8, 1.15, 0.9, 1.0];
  const tot = [3259, 4331, 2502, 2948, 5522, 8152];
  D.NP1 = {}; BR.NP1 = 'CPC'; kid('PNAPKIN', 'NP1');
  for (let wi = 0; wi < 6; wi++) for (let k = 0; k < 7; k++) {
    const d = alAdd('2026-10-13', wi * 7 + k), v = Math.round(tot[wi] / 7 * W8[(k + wi * 3) % 7]);
    D.NP1[d] = [v, v];
  }
  for (let d = FROM; d < '2026-10-13'; d = alAdd(d, 1)) D.NP1[d] = [466, 466];
  // one ordinary day just before the last (as on the real page): the old rule's "in a row" broke there; the week's total stays 8,152
  const moved = D.NP1['2026-11-22'][1] - 466; D.NP1['2026-11-22'] = [466, 466]; D.NP1[LAST] = [D.NP1[LAST][0] + moved, D.NP1[LAST][1] + moved];
}
// MV — CPC, down 40% for the whole 14 days — exactly as much as the whole CPC brand those weeks (in the run with the brand's days)
asin('MV1', 'CPC', 500, 10, d => (d >= '2026-11-10' && d <= LAST ? { x: 0.6 } : null)); kid('PMOVER', 'MV1');
// S — CPC: down 50% for 4 days, and the brand's same days last year fell 45% → seasonal dip (Watch)
asin('S1', 'CPC', 400, 40, d => (inn('2026-11-20', LAST)(d) ? { x: 0.5 } : null)); kid('PS', 'S1');

const dailyAsin = { d: D, brand: BR, from: FROM, upTo: TODAY, at: '2026-11-24 05:40' };
// stock: A1 and N1 at 0, the rest plenty (no entry for most → never "out of stock")
const stock = { SP: { m: { 'SKU-A1': 0, 'SKU-A2': 400, 'SKU-N1': 0, 'SKU-N2': 300, 'SKU-N3': 300, 'SKU-U1': 0, 'SKU-U2': 500 }, at: '2026-11-24T03:00:00Z',
  skuOf: { A1: ['SKU-A1'], A2: ['SKU-A2'], N1: ['SKU-N1'], N2: ['SKU-N2'], N3: ['SKU-N3'], U1: ['SKU-U1'], U2: ['SKU-U2'] } }, CPC: { m: {}, at: '', skuOf: {} } };
// the weekly traffic report: F sessions halve in the week of 15 Nov (units halve too: conversion normal); G sessions hold, units halve
const weeks = ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15'];
const wrow = (sess, u, last) => ({ brand: 'SP', weeks: Object.fromEntries(weeks.map(w => [w, w === '2026-11-15' ? last : { sessions: sess, u }])) });
const weekly = { rows: { F1: wrow(800, 56, { sessions: 400, u: 28 }), G1: wrow(800, 56, { sessions: 800, u: 28 }) }, at: '2026-11-23 06:00' };
// ad spend per day: H spend cut 80% from 20 Nov; J spend up 60%; M spend up 70% (its win)
const adsD = { SP: { H1: {}, J1: {}, M1: {}, X1: {} } };
days.filter(d => d <= '2026-11-22').forEach(d => {
  adsD.SP.H1[d] = [1000, 30, d >= '2026-11-20' ? 10 : 50, 3, d >= '2026-11-20' ? 30 : 120];
  adsD.SP.J1[d] = [1000, 30, d >= '2026-11-20' ? 64 : 40, 3, 90];
  adsD.SP.M1[d] = [1000, 30, d >= '2026-11-20' ? 68 : 40, 3, 150];
  adsD.SP.X1[d] = [1000, 30, d >= '2026-11-10' ? 10 : 50, 3, d >= '2026-11-10' ? 30 : 120];      // the Pillow Insert: ads cut too
});
const adsDay = { d: adsD, upTo: '2026-11-22', at: '2026-11-24 05:50' };
const plan = { 'PI|2026-11-08': { t: 'LIGHTNING', v: 20, s: '2026-11-10', d: 7 } };
// the brands' daily history (last year = 364 days back): SP flat; CPC flat except its same 4 days last year −45%
const ly = { SP: {}, CPC: {} };
for (let i = 0; i < 120; i++) {
  const d = alAdd('2025-09-01', i);
  ly.SP[d] = [5000, 200, 180];
  ly.CPC[d] = [3000, 100, 90];
}
['2025-11-21', '2025-11-22', '2025-11-23', '2025-11-24'].forEach(d => { ly.CPC[d] = [1650, 55, 50]; });
const base = { days: dailyAsin, today: TODAY, parentOf: a => PARENT[a] || a, nameOf: p => ({ PA: 'Round Tablecloth 70 inch', PO: 'Rectangle Tablecloth Main', PN: 'Napkins Set of 4' }[p] || 'Product ' + p),
  stock, weekly, adsDay, plan, lyDaily: ly, now: Date.parse('2026-11-24T10:00:00Z') };
const run = (more, brand) => X.alCompute(Object.assign({}, base, { brand: brand || 'SP' }, more || {}));
const R = run();
const dbg = a => (a ? JSON.stringify([a.list, a.kind, a.head || a.why, a.check && a.check.failed, a.check && a.check.proof, a.baseOut]) : 'none');
const find = (r, p, list) => (list ? r[list] : [].concat(r.alerts, r.waiting, r.recovered, r.wins, r.hidden, r.skipped || [], r.review || [])).find(a => a.parent === p);

console.log('== the maths ==');
ok('median of 4: one spike does not move it (100, 110, 90, 500 → 105)', X.alMedian([100, 110, 90, 500]) === 105);
ok('MAD: the median distance from the median (→ 10)', X.alMad([100, 110, 90, 500], 105) === 10);
ok('the window: the last finished day is yesterday (never today), 14 days back; 4 normal weeks before it',
  R.ok && R.last === LAST && R.window.from === '2026-11-10' && R.base.from === '2026-10-13' && R.base.to === '2026-11-09' && R.base.weeks === 4, JSON.stringify([R.last, R.window, R.base]));

console.log('== when it is an alert ==');
const A = find(R, 'PA');
ok('a real drop → an alert (4 low days, about −50%)', A && A.list === 'alerts' && A.days === 4 && Math.round(A.drop) >= 45, A && JSON.stringify([A.list, A.days, A.drop]));
const exp = A.run.reduce((s, d) => s + A.series.find(p => p.d === d).e, 0), act = A.run.reduce((s, d) => s + A.series.find(p => p.d === d).v, 0);
ok('$ at risk = (expected − actual) per low day × 7', Math.abs(A.atRisk - (exp - act) / A.days * 7) < 0.01 && Math.abs(A.exp - exp) < 0.01, `${A.atRisk} vs ${(exp - act) / A.days * 7}`);
ok('the hero total = the alerts\' $ at risk added up (a big product\'s Watch is not in it)', Math.abs(R.atRisk - R.alerts.filter(a => !a.soft).reduce((s, a) => s + a.atRisk, 0)) < 0.001);
ok('a small product (≈$280/week) never alerts, even −80%', !find(R, 'PB'));
ok('only 2 low days → "Waiting for data", never an alert', find(R, 'PC', 'waiting') && !find(R, 'PC', 'alerts') && /2 low days so far/.test(find(R, 'PC', 'waiting').why), find(R, 'PC') && find(R, 'PC').why);
ok('a fall today (a part day) never counts', !find(R, 'PT'));
const late = run({ days: Object.assign({}, dailyAsin, { upTo: '2026-11-22' }) });
ok('the nightly not in for yesterday: the last day is the last one held, and the page says so', late.last === '2026-11-22' && late.missing.join() === '2026-11-23');
ok('…a product with 1 low day held waits "for the nightly days"; one with 3 held low days is an alert', /nightly days for 23 Nov are not in yet/.test((find(late, 'PC', 'waiting') || {}).why || '') && !!find(late, 'PA', 'alerts'), JSON.stringify(find(late, 'PC') && [find(late, 'PC').list, find(late, 'PC').why]));
ok('the rows are ranked by $ at risk, biggest first (a big product\'s Watch after them)', R.alerts.every((a, i) => !i || (R.alerts[i - 1].soft ? a.soft && R.alerts[i - 1].atRisk >= a.atRisk : a.soft || R.alerts[i - 1].atRisk >= a.atRisk)));

console.log('== season ==');
const RC = run({}, 'CPC');
const Sx = find(RC, 'PS');
ok('the same days last year fell 45% (brand total) → "Seasonal dip", Watch — not Critical', Sx && Sx.list === 'alerts' && Sx.cause.k === 'season' && Sx.sev === 'watch', Sx && JSON.stringify([Sx.cause, Sx.sev, Sx.drop]));
// a small season lift (+3 % last year on the window's days) on steady products (their 4 weeks are equal: MAD 0) — found on the real page:
// without a minimum width the range was a line, every ordinary day "low", and a real 5-day drop was lost inside a 14-day "run"
const ly3 = { SP: Object.assign({}, ly.SP), CPC: ly.CPC };
for (let d = '2025-11-11'; d <= '2025-11-24'; d = alAdd(d, 1)) ly3.SP[d] = [5150, 200, 180];
const R3 = run({ lyDaily: ly3 });
ok('a small season lift on steady products: the same alerts, the same low days (the range is never narrower than ± 10 %)',
  R3.alerts.map(a => a.parent + a.days).sort().join() === R.alerts.map(a => a.parent + a.days).sort().join(), R3.alerts.map(a => a.parent + a.days).join());
ok('the season factor is capped 0.7–1.5 and used only when last year is held', RC.season.every(f => f == null || (f >= 0.7 && f <= 1.5)) && run({ lyDaily: null }).seasonHeld === false);

console.log('== the season only calms (real data, 24 Nov: Pillow Cover "−50% for 14 days" was the brand\'s November, not a drop) ==');
// the brand's last year: the 14 judged days ×1.4 its normal weeks (last year's November ramp, driven by other categories)
const lyUp = { SP: Object.assign({}, ly.SP), CPC: ly.CPC };
for (let d = '2025-11-11'; d <= '2025-11-24'; d = alAdd(d, 1)) lyUp.SP[d] = [7000, 200, 180];
const RU = run({ lyDaily: lyUp });
const V = find(RU, 'PV');
ok('a product 12% under its own normal weeks is no alert when the BRAND\'s last year rose ×1.4 (expected is never raised above its own weeks)', !V || V.list !== 'alerts', V && JSON.stringify([V.list, V.head, V.fDown]));
ok('…the brand factor is used ×1 for drops (never above), ×1.4 only against wins', RU.alerts.every(a => a.fDown === 1 && a.fUp === 1.4), JSON.stringify(RU.alerts.map(a => [a.parent, a.fDown, a.fUp])));
ok('…and the real drops stay exactly the same alerts, the same days', RU.alerts.map(a => a.parent + a.days).sort().join() === R.alerts.map(a => a.parent + a.days).sort().join(), RU.alerts.map(a => a.parent + a.days).join());
const lyDn = { SP: Object.assign({}, ly.SP), CPC: ly.CPC };
for (let d = '2025-11-11'; d <= '2025-11-24'; d = alAdd(d, 1)) lyDn.SP[d] = [4000, 200, 180];
const RD = run({ lyDaily: lyDn });
ok('the brand\'s last year fell ×0.8: drops are judged against less (calmer), and no flat product becomes a "win"',
  RD.alerts.every(a => Math.abs(a.fDown - 0.8) < 1e-9) && RD.alerts.length <= R.alerts.length && RD.wins.map(a => a.parent).join() === R.wins.map(a => a.parent).join(), JSON.stringify([RD.alerts.length, R.alerts.length, RD.wins.map(a => a.parent)]));
const W = find(R, 'PW');
ok('irregular normal weeks (×⅓, ×1, ×1, ×3⅓) → ⚠️ Needs a look "baseline too uneven", never an alert or a win; the range holds 3 of each weekday\'s 4 normal values by construction (≤ 25% outside)',
  W && W.list === 'review' && W.check.failed.includes('steady') && W.baseOut <= 0.25 && !R.alerts.some(a => a.parent === 'PW'), W && JSON.stringify([W.list, W.baseOut, W.check && W.check.failed]));
ok('…and the day self-check still guards: a product with only 3 normal weeks and one wild week is not judged', (() => {
  const d3 = Object.assign({}, dailyAsin, { from: '2026-10-20' });
  const w = find(run({ days: d3 }), 'PW'); return w && w.list === 'skipped' && /too irregular/.test(w.why); })(), dbg(find(run({ days: Object.assign({}, dailyAsin, { from: '2026-10-20' }) }), 'PW')));
ok('the range holds the normal days of every product that is judged (≤ 30% outside)', [].concat(R.alerts, R.waiting, R.recovered, R.wins).every(a => a.baseOut <= 0.3));
ok('baseline weeks keep their own range on the chart (no season on them)', RU.alerts.every(a => a.series.filter(p => p.d < '2026-11-10').every(p => Math.abs(p.e - (p.lo + p.hi) / 2) < Math.max(1, p.e * 0.6))));
const normA = X.alCardHtml(A).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ownA = Math.round(A.rawExp / A.days);
ok('each card: "Normal (own 4 weeks): $X/day · Expected used: $Y/day" — equal when nothing is adjusted',
  new RegExp(`Normal \\(own 4 weeks\\): \\$${ownA.toLocaleString('en-US')}/day · Expected used: \\$${ownA.toLocaleString('en-US')}/day`).test(normA), normA.match(/Normal[^·]*·[^$]*\$[\d,]+\/day/));
const normS = X.alCardHtml(find(RC, 'PS')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
ok('…and when the season lowered it, both numbers and why', /Normal \(own 4 weeks\): \$[\d,]+\/day · Expected used: \$[\d,]+\/day \(×0\.\d\d: the CPC total fell last year on these days\)/.test(normS), normS.match(/Normal.{0,140}/));
const TR = run({ trace: 'Round Tablecloth' }).traced;
ok('salesAlertsReport: the product\'s own weekly sales (Sun–Sat), its normal and expected per day, the season used and the self-check',
  TR.length === 1 && TR[0].weeks.length >= 5 && TR[0].weeks.every(w => typeof w.sales === 'number') && TR[0].seasonUsedForDrops === 1 && TR[0].baselineDaysOutsideRange === '0%' && TR[0].normalPerDay > 0, JSON.stringify(TR[0]).slice(0, 300));

console.log('== a sustained drop (real data, 24 Nov: the Pillow Insert low 13 of 14 days showed "waiting: 1 low day so far") ==');
const Xnew = find(R, 'PX'), Xold = find(run({ rule: 'run' }), 'PX');
ok('the old rule ("in a row") reproduces the real page: "waiting — 1 low day so far"', Xold && Xold.list === 'waiting' && /^1 low day so far/.test(Xold.why), Xold && JSON.stringify([Xold.list, Xold.why]));
ok('now: an alert over the 14 days, 13 below normal, about −54%', Xnew && Xnew.list === 'alerts' && Xnew.days === 14 && Xnew.lows === 13 && Math.round(Xnew.drop) >= 50
  && /sales down \d+% over 14 days \(13 below normal\)/.test(Xnew.head), Xnew && JSON.stringify([Xnew.list, Xnew.days, Xnew.lows, Xnew.drop, Xnew.head]));
ok('…its $ at risk counts all 14 days (the normal day too) — (expected − actual) ÷ 14 × 7', Xnew && Math.abs(Xnew.atRisk - (Xnew.exp - Xnew.act) / 14 * 7) < 0.01);
ok('…Critical: 13 low days (7+)', Xnew && Xnew.sev === 'critical');
ok('a day without a sale is a $0 day: the sold-out child has no entry on its low days, and they count', A.run.every(d => !(d in D.A1)) && Math.abs(A.act - A.run.reduce((s, d) => s + D.A2[d][1], 0)) < 0.01);
const Yr = find(R, 'PY');
ok('a BIG product back inside the range the last 2 days but its last week still −36% → 🟡 "Watch · recovering", not "Recovered"', Yr && Yr.list === 'alerts' && Yr.soft && Yr.state === 'Watch · recovering', Yr && JSON.stringify([Yr.list, Yr.state]));
ok('a small product back inside its range the last 2 days → "Recovered"', (find(R, 'PL') || {}).list === 'recovered');
ok('2 scattered low days among 5 → no alert (not most days)', !find(R, 'PZ'));
const Qs = Object.keys(QLOW).map(k => find(R, 'P' + k));
ok('every product low on MOST of the last 14 days (8–13 of them, normal days at random) is caught: a Confirmed alert, or "Needs a look" only when a judged week is not 20%+ down',
  Qs.every(q => q && (q.list === 'alerts' || (q.list === 'review' && q.kind === 'alerts' && q.check.failed.join() === 'weekly'))) && Qs.filter(q => q.list === 'alerts').length >= 6,
  JSON.stringify(Qs.map((q, i) => [i, q && q.list, q && q.lows, QLOW['R' + i].size])));
ok('…and its low days are the days it was low', Qs.every((q, i) => q && q.lowDays.every(d => QLOW['R' + i].has(d))));
ok('a fresh drop still alerts on its 3rd low day, as "New"', find(run({ days: Object.assign({}, dailyAsin, { d: Object.assign({}, D, { Q9: Object.fromEntries(Object.entries(D.A2).map(([d, v]) => [d, d >= '2026-11-21' && d <= LAST ? [2, 60] : v])) }), brand: Object.assign({}, BR, { Q9: 'SP' }) }) }), 'Q9', 'alerts').state === 'New');

console.log('== the trust check: every alert and win checked before it is shown (24 Nov) ==');
// the brands' own days THIS year for the trust check's "not the brand" — SP +35% in the judged weeks, CPC −40%
const brandRun = (spF, cpcF) => {
  const b = { SP: Object.assign({}, ly.SP), CPC: Object.assign({}, ly.CPC) };
  for (let d = '2026-10-06'; d <= LAST; d = alAdd(d, 1)) { const j = d >= '2026-11-10'; b.SP[d] = [j ? 50000 * spF : 50000, 1, 1]; b.CPC[d] = [j ? 3000 * cpcF : 3000, 1, 1]; }
  return b;
};
const Xc = find(R, 'PX');
ok('Pillow Insert: a real drop, ads cut → ✅ Confirmed, the cause "Ads cut"', Xc && Xc.list === 'alerts' && Xc.check.ok && Xc.cause.k === 'adsCut', dbg(Xc));
const RB = run({ brandDaily: brandRun(1.35, 1) });
const PCv = find(RB, 'PCOVER');
ok('Block Print Pillow Cover: $14.8k → $10.7k / $11.0k with the brand +35% → ✅ Confirmed', PCv && PCv.list === 'alerts' && PCv.check.ok, dbg(PCv));
ok('…its proof line: "Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−27%), Ridhi +35% same weeks, steady baseline."',
  PCv && PCv.check.proof === 'Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−27%), Ridhi +35% same weeks, steady baseline.', PCv && PCv.check.proof);
ok('…and the card shows it', PCv && X.alCardHtml(PCv).includes('Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−27%)'));
const Vb = find(RU, 'PV');
ok('the old false Pillow alert (brand season ×1.4 inflating expected) → not shown: no alert, not even "needs a look"', !Vb || !['alerts', 'review', 'hidden'].includes(Vb.list), dbg(Vb));
const NPc = find(RC, 'PNAPKIN');
ok('CPC Cotton print club Napkin: +69% / +150% over its own weeks → ✅ Confirmed win (the win rule mirrors the drop rule)', NPc && NPc.list === 'wins' && NPc.check.ok, dbg(NPc));
ok('…with the old win rule ("in a row") it showed nothing — the real-page symptom', (() => { const o = find(run({ rule: 'run' }, 'CPC'), 'PNAPKIN'); return !o || o.list !== 'wins'; })());
const MVb = find(run({ brandDaily: brandRun(1, 0.6) }, 'CPC'), 'PMOVER');
ok('a product down 40% exactly as the whole brand (−40% the same weeks) → no alert: "moves with the brand"', MVb && MVb.list === 'review' && MVb.check.failed.join() === 'brand' && /moves with the brand/.test(MVb.check.proof), dbg(MVb));
ok('…the same product with no brand move → ✅ Confirmed', (find(RC, 'PMOVER') || {}).list === 'alerts', dbg(find(RC, 'PMOVER')));
const UBc = find(R, 'PUB');
ok('an uneven baseline (one normal week 65% over the average) → ⚠️ Needs a look: "baseline too uneven"', UBc && UBc.list === 'review' && UBc.check.failed.includes('steady') && /② baseline uneven: weeks /.test(UBc.check.proof), dbg(UBc));
ok('Needs a look is never in the hero, the chips or the Dashboard numbers', R.review.length >= 1 && !R.alerts.some(a => R.review.includes(a))
  && Math.abs(R.atRisk - R.alerts.filter(a => !a.soft).reduce((s, a) => s + a.atRisk, 0)) < 0.01 && R.counts.critical + R.counts.important + R.counts.watch === R.alerts.length);
const fake = { list: 'alerts', brand: 'SP', run: [], exp: 1200, rawExp: 1000 };
const fev = { N: [7000, 7000, 7000, 7000], J1: 4000, J2: 4000, bN: [null], bJ1: null, bJ2: null, complete: true };
ok('check ⑤: expected moved above its own normal weeks (season inflation) → fails "season"', X.alVerify(fake, fev, { S: X.AL_DEF, last: LAST }).failed.join() === 'season');
ok('check ④: a product under $500/week normal fails "volume"', X.alVerify(Object.assign({}, fake, { exp: 900 }), Object.assign({}, fev, { N: [400, 400, 400, 400], J2: 200 }), { S: X.AL_DEF, last: LAST }).failed.join() === 'volume');
ok('check ①: a fresh 4-day drop is checked on the last week only', X.alVerify(Object.assign({}, fake, { exp: 900, run: ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'] }), Object.assign({}, fev, { J1: 7000, J2: 5000 }), { S: X.AL_DEF, last: LAST }).ok);
const heroT = X.alHeroHtml(R).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
ok('the summary under the hero: "Sellora checked N products · X confirmed drops · Y confirmed wins · Z need a look · W not judged"',
  heroT.includes(`Sellora checked ${R.checked} products · ${R.alerts.length} confirmed drops · ${R.wins.length} confirmed win${R.wins.length === 1 ? '' : 's'} · ${R.review.length} need${R.review.length === 1 ? 's' : ''} a look (${R.review.filter(a => a.kind === 'alerts').length} drops, ${R.review.filter(a => a.kind === 'wins').length} wins) · ${R.skipped.length} not judged`), heroT.slice(heroT.indexOf('Sellora'), heroT.indexOf('Sellora') + 200));
const lookD = R.review.filter(a => a.kind === 'alerts');
ok('one line under the hero: "+ $X/week more waiting for a check (N items)" — never in the hero sentence',
  heroT.includes(`+ $${Math.round(lookD.reduce((s, a) => s + a.atRisk, 0)).toLocaleString('en-US')}/week more waiting for a check (${lookD.length} items)`) && !heroT.startsWith(`${R.alerts.length + lookD.length} products`), heroT.slice(heroT.indexOf('+ $'), heroT.indexOf('+ $') + 90));
const critToCheck = lookD.filter(a => a.sev === 'critical').length;
ok('the chips count confirmed only, with what waits for a check in grey: "Critical N (+M to check)"', critToCheck > 0 && heroT.includes(`Critical ${R.counts.critical} (+${critToCheck} to check)`), heroT.slice(heroT.indexOf('Critical'), heroT.indexOf('Critical') + 40));

console.log('== real data, 24 Nov: everything sat in "Needs a look" — the own-last-year factor from the weekly store\'s scattered old cells ==');
// Pillow Cover with the real weeks: 15,439 / 14,457 / 14,779 / 14,445 → 10,729 / 11,017 (one 7-day week each, every day the same share)
const PCW = [15439, 14457, 14779, 14445, 10729, 11017];
const real = () => {
  const d = Object.assign({}, D), br = Object.assign({}, BR);
  d.RPC1 = {}; br.RPC1 = 'SP'; PARENT.RPC1 = 'RPCOVER';
  for (let wi = 0; wi < 6; wi++) for (let k = 0; k < 7; k++) { const day = alAdd('2026-10-13', wi * 7 + k), v = Math.round(PCW[wi] / 7 * 100) / 100; d.RPC1[day] = [Math.round(v / 20), v]; }
  // the six real wins (Ridhi): normal $900/day, then +80 %, +154 %, +128 %, +81 %, +66 %, +51 % both judged weeks; one has zero-sale days in its normal weeks
  [80, 154, 128, 81, 66, 51].forEach((p, i) => {
    const a = 'RW' + i; d[a] = {}; br[a] = 'SP'; PARENT[a] = 'RWIN' + i;
    for (let day = '2026-10-13'; day <= LAST; day = alAdd(day, 1)) {
      const zero = i === 5 && day < '2026-11-10' && alDow(day) === 2;           // Table Runner: no sale on Tuesdays (a $0 day, never "missing")
      const v = day >= '2026-11-10' ? 900 * (1 + p / 100) : zero ? 0 : 900 * (i === 5 ? 7 / 6 : 1);
      if (v) d[a][day] = [Math.round(v / 30), v];
    }
  });
  return { d, br };
};
const alDow = k => new Date(k + 'T00:00:00Z').getUTCDay();
const RD0 = real();
// a weekly store holding SCATTERED last-year cells (as PPC & Organic's never-pruned rows do): a bogus "own last year" ×1.5 for the cover
const oldCells = { rows: Object.assign({}, weekly.rows, { RPC1: { brand: 'SP', weeks: Object.fromEntries(['2025-11-09', '2025-11-16', '2025-10-12', '2025-10-19', '2025-10-26', '2025-11-02'].map((k, i) => [k, { rev: i < 2 ? 15000 : 10000 }])) } }) };
const runReal = (more, brand) => run(Object.assign({ days: Object.assign({}, dailyAsin, { d: RD0.d, brand: RD0.br }), weekly: oldCells }, more || {}), brand);
const withBrand = runReal({ brandDaily: brandRun(1.35, 1) }), noBrand = runReal();
[['brand +35% held', withBrand], ['brand not held', noBrand]].forEach(([t, r]) => {
  const p = find(r, 'RPCOVER');
  ok(`Ridhi Block Print Pillow Cover (real weeks, ${t}; weekly store with scattered old cells) → 🔴 Critical, ✅ Confirmed, 14 days`, p && p.list === 'alerts' && p.sev === 'critical' && p.check.ok && p.days === 14 && p.atRisk >= 2000, dbg(p));
});
ok('…its proof (real weeks: 10,873 ÷ 14,780 = −26.4%): "Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−26%), Ridhi +35% same weeks, steady baseline."',
  (find(withBrand, 'RPCOVER') || { check: {} }).check.proof === 'Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−26%), Ridhi +35% same weeks, steady baseline.', (find(withBrand, 'RPCOVER') || { check: {} }).check.proof);
ok('…and without the brand\'s days: "brand not held for these weeks" — check ③ passes', /brand not held for these weeks/.test((find(noBrand, 'RPCOVER') || { check: {} }).check.proof));
ok('the expected used is never above its own normal weeks — the store\'s old cells are not read as "its own last year"', (find(withBrand, 'RPCOVER') || {}).fOwn == null && (find(withBrand, 'RPCOVER') || {}).fDown <= 1);
[0, 1, 2, 3, 4, 5].forEach(i => {
  const w = find(withBrand, 'RWIN' + i);
  ok(`real win ${['Embroidery Napkin +80%', 'Tablecloth 2 +154%', 'Cotton Napkins 20" +128%', 'Pillow Inserts +81%', 'Asparagus Blue Paisley Round +66%', 'Table Runner +51% (zero-sale Tuesdays)'][i]} → ✅ in Wins`, w && w.list === 'wins' && w.check.ok, dbg(w));
});
ok('the summary agrees with the lists: every "confirmed win" is in Wins, none in Needs a look', withBrand.wins.every(a => a.check.ok) && withBrand.review.every(a => !a.check.ok));
// the Whimsical Pillow Insert (CPC): the X1 pattern in CPC
{
  const d = Object.assign({}, D, { WPI1: D.X1 }), br = Object.assign({}, BR, { WPI1: 'CPC' }); PARENT.WPI1 = 'WHIMSICAL';
  const p = find(run({ days: Object.assign({}, dailyAsin, { d, brand: br }), weekly: oldCells }, 'CPC'), 'WHIMSICAL');
  ok('THE WHIMSICAL CORNER Pillow Insert (CPC) → 🔴 Critical, ✅ Confirmed', p && p.list === 'alerts' && p.sev === 'critical' && p.check.ok, dbg(p));
}
ok('CPC Cotton print club Napkin → ✅ Win', (find(runReal({}, 'CPC'), 'PNAPKIN') || {}).list === 'wins');
ok('zero-sale days are $0, never "missing": the Table Runner\'s no-sale Tuesdays pass ④', (find(withBrand, 'RWIN5') || { check: { checks: [] } }).check.checks.find(c => c.k === 'volume').ok);
{
  // a real gap: one date that NO product has (the load missed it) → ④ "data incomplete", Needs a look
  const d = {}; Object.entries(RD0.d).forEach(([a, byDay]) => { d[a] = Object.assign({}, byDay); delete d[a]['2026-10-20']; });
  const p = find(run({ days: Object.assign({}, dailyAsin, { d, brand: RD0.br }), brandDaily: brandRun(1.35, 1) }), 'RPCOVER');
  ok('a date no product has at all (a gap in the load) → ④ "data incomplete: no figures at all for 20 Oct" → Needs a look', p && p.list === 'review' && p.check.failed.join() === 'volume' && /data incomplete: no figures at all for 20 Oct/.test(p.check.proof), dbg(p));
}
const csv = X.alCsvText(R).split('\r\n');
ok('Download full check (CSV): a header with the six weeks and one row per product checked, each with its verdict',
  csv.length === R.checked + 1 && /Normal week 1 \(13 Oct–19 Oct\) \$/.test(csv[0]) && /Judged week 2 \(17 Nov–23 Nov\) \$/.test(csv[0])
  && csv.some(l => /^Ridhi,PX,.*Confirmed drop/.test(l)) && csv.some(l => /^Ridhi,PUB,.*Needs a look \(drop\)/.test(l)) && csv.some(l => /^Ridhi,PB,.*Small/.test(l)), csv[0]);

console.log('== a big product\'s Watch (real data, 24 Nov: the Pillow Cover −30% then −19% — −24% in all — showed "no alert") ==');
{
  // the exact judged weeks 10,255 and 11,805 after normal weeks averaging $14.6k (15,250 / 14,300 / 14,600 / 14,250)
  const W = [15250, 14300, 14600, 14250, 10255, 11805];
  const build = (a, weeks, perDay) => { const d = {}; for (let wi = 0; wi < 6; wi++) for (let k = 0; k < 7; k++) { const day = alAdd('2026-10-13', wi * 7 + k), v = perDay ? perDay(wi, k) : weeks[wi] / 7; d[day] = [Math.max(1, Math.round(v / 20)), Math.round(v * 100) / 100]; } return d; };
  const with1 = (asin, parent, byDay, brand) => { PARENT[asin] = parent; return Object.assign({}, dailyAsin, { d: Object.assign({}, D, { [asin]: byDay }), brand: Object.assign({}, BR, { [asin]: brand || 'SP' }) }); };
  const days1 = with1('BPC1', 'BPCOVER', build('BPC1', W));
  const RW = run({ days: days1, brandDaily: brandRun(1.35, 1) });
  const B = find(RW, 'BPCOVER');
  ok('the plain alert rule: −24% is under the 25% line → no alert (what the real page showed)', !find(run({ days: days1, brandDaily: brandRun(1.35, 1), settings: { bigWeek: 1e9 } }), 'BPCOVER'));
  ok('now: 🟡 Watch — "recovering" (−30% then −19%), ✅ confirmed by the trust checks', B && B.list === 'alerts' && B.sev === 'watch' && B.soft && B.watchState === 'recovering' && B.check.ok && B.state === 'Watch · recovering', dbg(B));
  ok('…its ① is the Watch one: each judged week 10%+ down, 15%+ together', B && /weekly \(Watch\).*−30% \/ −19%/.test(B.check.checks[0].t) && B.check.checks[0].ok, B && B.check.checks[0].t);
  ok('…its headline says so', B && /sales down 2\d(\.\d)?% over 14 days — recovering · a big product: Watch$/.test(B.head), B && B.head);
  ok('…it counts in the Watch chip, never in $ at risk (hero, Dashboard)', RW.counts.watch >= 1 && Math.abs(RW.atRisk - RW.alerts.filter(a => !a.soft).reduce((s, a) => s + a.atRisk, 0)) < 0.01 && RW.watchUsd >= B.atRisk - 0.01);
  const heroW = X.alHeroHtml(RW).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  { const nw = RW.alerts.filter(a => a.soft).length;
  ok('…the hero names Watch beside the real drops ("· N big products to watch"), never in their count', heroW.includes(`${RW.alerts.filter(a => !a.soft).length} products need attention`) && heroW.includes(`· ${nw} big product${nw === 1 ? '' : 's'} to watch`), heroW.slice(0, 140)); }
  ok('…the card: "−$X / week · Watch — not in the total"', X.alCardHtml(B).replace(/<[^>]+>/g, ' ').includes('/ week · Watch — not in the total'));
  // the other route: one judged week −22%, the other −12% — fewer than half the days below the range (no lasting-drop stretch)
  const days2 = with1('BPC2', 'BPCOVER2', build('BPC2', null, (wi, k) => 2100 * (wi < 4 ? 1 : wi === 4 ? (k === 6 ? 1 : 0.74) : (k === 3 ? 0.3 : 0.98))));
  const B2 = find(run({ days: days2 }), 'BPCOVER2');
  ok('or one judged week 20%+ down and the other 10%+ down (fewer than half the days low) → 🟡 Watch', B2 && B2.list === 'alerts' && B2.sev === 'watch' && B2.soft && B2.check.ok, dbg(B2));
  // a smaller product: −20% for 14 days, $1,400/week normal → never a Watch (and under the alert line)
  const days3 = with1('SM1', 'SMALL', build('SM1', null, (wi) => 200 * (wi < 4 ? 1 : 0.8)));
  ok('a product under $2,000/week, −20% for 14 days → no Watch', !find(run({ days: days3 }), 'SMALL'));
  ok('the old ("in a row") rule never makes a Watch', !find(run({ days: days1, rule: 'run' }), 'BPCOVER') || find(run({ days: days1, rule: 'run' }), 'BPCOVER').sev !== 'watch');
}
console.log('== the real Pillow Cover weeks 15,027 / 14,579 / 14,351 / 14,312 → 10,255 / 11,805: one verdict, however the days fall ==');
{
  const W = [15027, 14579, 14351, 14312, 10255, 11805];
  // four ways the same weeks' days can fall — before this fix they gave Watch, Recovered, Waiting and "Needs a look (Critical)"
  const PATTERNS = [[1.25, 0.8, 1.05, 0.9, 1.15, 0.85, 1.0], [0.8, 1.25, 1.05, 0.9, 1.15, 0.85, 1.0], [1.0, 1.3, 0.75, 1.1, 0.85, 1.2, 0.8], [0.75, 1.3, 1.0, 1.2, 0.8, 1.15, 0.8]];
  PATTERNS.forEach((wt, pi) => {
    const byDay = {};
    for (let wi = 0; wi < 6; wi++) for (let k = 0; k < 7; k++) {
      const day = alAdd('2026-10-13', wi * 7 + k), v = Math.round(W[wi] / 7 * wt[(k + wi * 2) % 7] * 100) / 100;
      byDay[day] = [Math.max(1, Math.round(v / 20)), v];
    }
    PARENT['RPC' + pi] = 'REALCOVER' + pi;
    const r = run({ days: Object.assign({}, dailyAsin, { d: Object.assign({}, D, { ['RPC' + pi]: byDay }), brand: Object.assign({}, BR, { ['RPC' + pi]: 'SP' }) }), brandDaily: brandRun(1.35, 1) });
    const p = find(r, 'REALCOVER' + pi);
    ok(`day pattern ${pi + 1}: 🟡 Watch · recovering, ✅ confirmed (weeks −30% / −19%), never in $ at risk`,
      p && p.list === 'alerts' && p.sev === 'watch' && p.soft && p.state === 'Watch · recovering' && p.check.ok && /−30% \/ −19%/.test(p.check.checks[0].t)
      && Math.abs(r.atRisk - r.alerts.filter(a => !a.soft).reduce((s, a) => s + a.atRisk, 0)) < 0.01, dbg(p));
    ok(`day pattern ${pi + 1}: in exactly one place`, r.dupes.length === 0 && [].concat(r.alerts, r.waiting, r.recovered, r.wins, r.hidden, r.skipped, r.review).filter(a => a.parent === 'REALCOVER' + pi).length === 1);
  });
  const p4 = (() => { const r = run({ days: Object.assign({}, dailyAsin, { d: Object.assign({}, D, { RPC3: (() => { const b = {}; for (let wi = 0; wi < 6; wi++) for (let k = 0; k < 7; k++) { const day = alAdd('2026-10-13', wi * 7 + k), v = Math.round(W[wi] / 7 * PATTERNS[3][(k + wi * 2) % 7] * 100) / 100; b[day] = [Math.max(1, Math.round(v / 20)), v]; } return b; })() }), brand: Object.assign({}, BR, { RPC3: 'SP' }) }), brandDaily: brandRun(1.35, 1), settings: { bigWeek: 1e9 } }); return find(r, 'REALCOVER3'); })();
  ok('…pattern 4 is the real page\'s: without the big-product Watch it is "Needs a look", Critical — its alert fails only ① (the last week −19%)', p4 && p4.list === 'review' && p4.sev === 'critical' && p4.check.failed.join() === 'weekly', dbg(p4));
}
console.log('== one rounded value, the line decided unrounded ==');
ok('24.6% shows as "−24.6%" (half a point from the 25% line), 26.4% as "−26%", 19.1% as "−19%", 25.3% as "−25.3%"',
  X.ctx.alPctL(-24.6) === '−24.6%' && X.ctx.alPctL(-26.4) === '−26%' && X.ctx.alPctL(-19.1) === '−19%' && X.ctx.alPctL(-25.3) === '−25.3%' && X.ctx.alPctL(24.6, false) === '24.6%');
console.log('== the page, the Dashboard, the strip and salesAlertsReport read ONE result ==');
{
  const Z = load({ VI: { v: 1, data: { days: dailyAsin, stock, weekly } }, sdDays: ch => ly[ch] || {}, SD: { at: 'x', d: { SP: {}, CPC: {} } }, wParentOf: a => PARENT[a] || a, viNameOf: p => 'Product ' + p });
  Z.AL.data = { adsDay, plan }; Z.AL.v = 1;
  const r1 = Z.alFor('SP'), r2 = Z.alFor('SP');
  ok('alFor gives the very same object while nothing changed, with every product traced (the report reads it)', r1 === r2 && r1.traced && r1.traced.length === r1.checked);
  Z.ctx.SD = { at: 'y', d: { SP: {}, CPC: {} } };
  ok('…and a new one as soon as an input changes (the Sales Dashboard\'s days here)', Z.alFor('SP') !== r1);
  ok('one place per product in the whole fixture', R.dupes.length === 0 && RC.dupes.length === 0);
}
console.log('== salesAlertsReport: the five checks for EVERY product ==');
{
  const T = run({ trace: '' });
  ok('every product is traced with its five checks ✓ / ✗ (alerts, wins and "no alert" alike) and the engine\'s reading of its 14 days',
    T.traced.length === T.checked && T.traced.every(t => t.checkLines && t.checkLines.length === 5 && t.checkLines.every(l => /^ {2}[✓✗] [①②③④⑤] /.test(l)) && t.judged && typeof t.judged.pct === 'number'), JSON.stringify(T.traced.find(t => !t.checkLines || t.checkLines.length !== 5)));
  const steady = T.traced.find(t => t.parent === 'PT');
  ok('…a product with no alert gets them run on its 14 judged days', steady && steady.own === true && steady.checkLines.length === 5, JSON.stringify(steady && steady.checkLines));
}

console.log('== the causes ==');
const cause = p => (find(R, p, 'alerts') || { cause: {} }).cause;
ok('out of stock: FBA 0 for 1 of 2 children, no sale since 20 Nov · High', cause('PA').k === 'oos' && cause('PA').conf === 'High' && /FBA 0 for 1 of 2 children/.test(cause('PA').ev) && /no sale since 20 Nov/.test(cause('PA').ev), JSON.stringify(cause('PA')));
ok('price: old → new price shown, since the day it changed', cause('PE').k === 'price' && /\$20\.\d\d → \$24\.\d\d \(\+\d+%\)/.test(cause('PE').ev) && /since 19 Nov/.test(cause('PE').ev), JSON.stringify(cause('PE')));
const U = find(R, 'PU', 'alerts');
ok('a dear size sold out beside a cheap one: out of stock — never "price change" (price is like for like per child)', U && U.cause.k === 'oos' && !U.causes.some(x => x.k === 'price'), U && JSON.stringify(U.causes));
ok('traffic down: sessions −50%, conversion normal', cause('PF').k === 'traffic' && /800 → 400/.test(cause('PF').ev), JSON.stringify(cause('PF')));
ok('conversion down: sessions the same, conversion −50% → listing / reviews / Buy Box', cause('PG').k === 'conv' && /7\.0% → 3\.5%/.test(cause('PG').ev), JSON.stringify(cause('PG')));
ok('ads cut: spend $50/day → $10/day, ad sales down', cause('PH').k === 'adsCut' && /\$50\/day → \$10\/day/.test(cause('PH').ev), JSON.stringify(cause('PH')));
ok('deal ended: the Deal Calendar\'s Lightning 20% ended 16 Nov', cause('PI').k === 'deal' && /Lightning 20% ended 16 Nov/.test(cause('PI').ev), JSON.stringify(cause('PI')));
ok('ads up, no sales: spend +60% while sales fell → wasted spend', cause('PJ').k === 'adsUp' && /\+60%/.test(cause('PJ').ev), JSON.stringify(cause('PJ')));
ok('nothing in the data → "No clear cause — check listing / Buy Box"', cause('PK').k === 'none' && X.alNext(cause('PK')) === 'Check listing / Buy Box');
ok('ad figures not in yet for the low days → said, never claimed', run({ adsDay: Object.assign({}, adsDay, { upTo: '2026-11-15' }) }).alerts.find(a => a.parent === 'PH').notes.some(n => /ad figures .* not in yet/.test(n)));
ok('sessions for the low days not in yet (weekly report) → said, never claimed', find(R, 'PA', 'alerts').notes.some(n => /sessions .* not in yet/.test(n)));
ok('the next step follows the cause', X.alNext({ k: 'oos' }) === 'Check replenishment / send inbound' && X.alNext({ k: 'adsCut' }) === 'Check campaign status / budget'
  && X.alNext({ k: 'traffic' }) === 'Check BSR / ads / search rank' && X.alNext({ k: 'conv' }) === 'Check listing, reviews, Buy Box' && X.alNext({ k: 'deal' }) === 'Normal after a deal — watch 7 days'
  && /^Review the price change on 19 Nov$/.test(X.alNext(cause('PE'), find(R, 'PE'))));
ok('the headline in plain English', /^Round Tablecloth 70 inch sales down \d+% for 4 days — likely out of stock$/.test(A.head), A.head);

console.log('== siblings, severity, life cycle ==');
const N = find(R, 'PN', 'alerts');
ok('siblings grouped under the parent by their own cause: 1 out of stock, 1 price', N && N.groups.length === 2 && N.groups.find(g => g.k === 'oos').asins.join() === 'N1' && N.groups.find(g => g.k === 'price').asins.join() === 'N2', N && JSON.stringify(N.groups));
const O = find(R, 'PO', 'alerts');
ok('8 low days → Critical (7+ days), "Day 8"', O && O.sev === 'critical' && O.state === 'Day 8', O && JSON.stringify([O.sev, O.state, O.atRisk]));
ok('severity by money: ≥ $2,000 Critical · ≥ $500 Important · else Watch', R.alerts.filter(a => a.cause.k !== 'season' && !a.soft).every(a => a.sev === (a.atRisk >= 2000 || a.days >= 7 ? 'critical' : a.atRisk >= 500 ? 'important' : 'watch')));
ok('a 3rd low day today → "New"', run({ days: Object.assign({}, dailyAsin, { d: Object.assign({}, D, { Q1: Object.fromEntries(Object.entries(D.A2).map(([d, v]) => [d, d >= '2026-11-21' && d <= LAST ? [2, 60] : v])) }), brand: Object.assign({}, BR, { Q1: 'SP' }) }) }).alerts.find(a => a.parent === 'Q1').state === 'New');
const L = find(R, 'PL');
ok('recovery: back inside the range 2+ days → "Recovered", the alert closes itself', L && L.list === 'recovered' && L.back === 4 && !find(R, 'PL', 'alerts'), L && JSON.stringify([L.list, L.back]));
const id = A.id;
const snoozed = run({ marks: { [id]: { a: 'snooze', by: 'x@y', at: base.now, until: base.now + 7 * 864e5 } } });
ok('snooze 7 days: the alert steps aside (kept with who and when) and leaves the hero total', !find(snoozed, 'PA', 'alerts') && find(snoozed, 'PA', 'hidden').mark.by === 'x@y' && Math.abs(snoozed.atRisk - (R.atRisk - A.atRisk)) < 0.01);
const hidRow = X.alRowHtml(find(snoozed, 'PA', 'hidden'));
ok('a snoozed row says by whom and until when, with Undo — and no Snooze / Dismiss buttons', /Snoozed until 1 Dec by x@y/.test(hidRow.replace(/<[^>]+>/g, ' ')) && /data-al-act="undo"/.test(hidRow) && !/data-al-act="snooze"/.test(hidRow));
ok('…and comes back after 7 days', !!find(run({ marks: { [id]: { a: 'snooze', until: base.now - 1 } } }), 'PA', 'alerts'));
ok('dismiss hides only that drop: a new drop (another start day) shows again', !find(run({ marks: { [id]: { a: 'dismiss' } } }), 'PA', 'alerts') && !!find(run({ marks: { [id.replace(/\|[^|]+$/, '|2026-11-01')]: { a: 'dismiss' } } }), 'PA', 'alerts'));
const M = find(R, 'PM', 'wins');
ok('a win: +60% above expected for 4 days — "ads push working"', M && Math.round(M.gain) >= 55 && M.why === 'ads push working', M && JSON.stringify([M.gain, M.why]));
ok('the settings move the line: drop at least 70% → the −50% drops are no alert', !find(run({ settings: { drop: 70 } }), 'PK', 'alerts'));
ok('All = Ridhi + CPC', run({}, 'ALL').alerts.length === R.alerts.length + RC.alerts.length);

console.log('== the page and the Dashboard ==');
X.AL.filter = '';
const hero = X.alHeroHtml(R).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
ok('the hero: "N products need attention · $X/week at risk" + the five chips', new RegExp(`${R.alerts.filter(a => !a.soft).length} products need attention · \\$[\\d,]+ /week at risk`).test(hero) && /Critical/.test(hero) && /Waiting for data/.test(hero) && /Recovered this week/.test(hero), hero.slice(0, 160));
const none = X.alHeroHtml(Object.assign({}, R, { alerts: [], atRisk: 0 })).replace(/<[^>]+>/g, ' ');
ok('nothing to fix → "All good — no real drops this week ✅"', /All good — no real drops this week ✅/.test(none));
const card = X.alCardHtml(A).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
ok('a top card: headline, −$/week, the cause with its evidence and confidence, what to do, Snooze / Dismiss (the "+ Task" button comes from the Action Tracker, sales/tasks.js — not loaded here; the old "coming soon" placeholder is gone)',
  /−\$[\d,]+ \/ week/.test(card) && /Out of stock · FBA 0/.test(card) && /High confidence/.test(card) && /Check replenishment \/ send inbound/.test(card) && /Snooze 7 days/.test(card) && /Dismiss/.test(card) && !/Coming soon/.test(card) && /tkBtnHtml\(\{ src: 'alert'/.test(SRC), card.slice(0, 300));
ok('at most 2 cause pills on a card', (X.alCardHtml(N).match(/class="al-pill/g) || []).length <= 2);
const Y = load({ VI: { v: 1, data: { days: dailyAsin, stock, weekly } }, sdDays: ch => ly[ch] || {}, SD: { at: 'x', d: { SP: {}, CPC: {} } }, wParentOf: a => PARENT[a] || a,
  viNameOf: p => 'Product ' + p });
Y.AL.data = { adsDay, plan }; Y.AL.v = 1;
const dv = Y.alDashOf('SP');
ok('the Dashboard: how many, $/week at risk, the top three (biggest money first)', dv.n === R.alerts.length && dv.top.length === 3 && dv.top[0].usd >= dv.top[1].usd && /up to 23 Nov/.test(dv.when), JSON.stringify(dv).slice(0, 200));
ok('the Dashboard\'s Both = Ridhi + CPC', Y.alDashOf('ALL').n === R.alerts.length + RC.alerts.length);

console.log(`\n${pass} passed, ${fail} failed`);
console.log('\n-- the fixture (Ridhi) --');
R.alerts.forEach(a => console.log(`  ${a.sev.padEnd(9)} ${a.head}  ·  −$${Math.round(a.atRisk)}/wk  ·  ${a.cause.t}: ${a.cause.ev}`));
R.waiting.forEach(a => console.log(`  waiting   ${a.name} — ${a.why}`));
R.recovered.forEach(a => console.log(`  recovered ${a.head}`));
R.wins.forEach(a => console.log(`  win       ${a.head}  +$${Math.round(a.extra)}/wk`));
RC.alerts.forEach(a => console.log(`  CPC ${a.sev.padEnd(5)} ${a.head}  ·  ${a.cause.t}: ${a.cause.ev}`));
process.exit(fail ? 1 : 0);
