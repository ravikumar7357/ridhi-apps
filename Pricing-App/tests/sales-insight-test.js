/* "This week in plain English" (src/app/sales/sales-insight.js, Sales card #2): the movers maths, the add-up check, the drivers (out of
 * stock, price, traffic, ad spend, conversion, seasonal, none), the number check on Claude's text, and the rule-written fallback.
 *   node tests/sales-insight-test.js            (prints a sample of the box on the test data at the end) */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', 'sales-insight.js'), 'utf8');

function load(extra) {
  const store = {};
  const ctx = vm.createContext(Object.assign({
    console, Intl, Math, JSON, Number, String, Object, Array, Set, Map, Promise, Date, isFinite, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    WEEKLY: { weeks: [], rows: {} }, HEALTH: { SP: { rows: [] }, CPC: { rows: [] } }, H_LOADED: true, ME: { admin: true, tabs: [] }, SD_CH: 'SP',
    sdToday: () => '2026-11-23',
  }, extra || {}));
  vm.runInContext(SRC + '\n;this.__x = { VI, VI_T, viCompute, viDriver, viRuleText, viAiFacts, viNumbersOk, viNums, viSummary, viAiKey, viKeptSet, viBoxHtml, viDashOf, viFor, viWeeks, viLabel, viMoney };', ctx);
  return Object.assign(ctx.__x, { ctx, store });
}

/* ---- the fixture: Mon 23 Nov 2026 (PT) → last finished week Sun 15 – Sat 21 Nov, against 8–14 Nov; last year 16–22 Nov 2025 ---- */
const L = '2026-11-15', P = '2026-11-08', LY = '2025-11-16', LYP = '2025-11-09';
const cell = (u, rev, more) => Object.assign({ u, rev }, more || {});
const ROWS = {
  // A: a parent of two children, out of stock now (0 FBA units) with 3 days without a sale last week
  A1: { brand: 'SP', weeks: { [P]: cell(60, 1200, { sessions: 600, spend: 120 }), [L]: cell(24, 480, { sessions: 570, spend: 114 }) } },
  A2: { brand: 'SP', weeks: { [P]: cell(40, 800, { sessions: 400, spend: 80 }), [L]: cell(16, 320, { sessions: 380, spend: 76 }) } },
  // B: the same units, a higher price → "price +15%"
  B1: { brand: 'SP', weeks: { [P]: cell(50, 1000), [L]: cell(50, 1150) } },
  // C: half the sessions, ad spend held → "traffic −50% (sessions)"
  C1: { brand: 'SP', weeks: { [P]: cell(60, 1200, { sessions: 600, spend: 100 }), [L]: cell(30, 600, { sessions: 300, spend: 100 }) } },
  // D: ad spend cut 60% → "ad spend −60%"
  D1: { brand: 'SP', weeks: { [P]: cell(25, 500, { sessions: 300, spend: 200 }), [L]: cell(15, 300, { sessions: 280, spend: 80 }) } },
  // E: the same sessions, half the units → "conversion −50%"
  E1: { brand: 'SP', weeks: { [P]: cell(40, 800, { sessions: 400 }), [L]: cell(20, 400, { sessions: 400 }) } },
  // F: up, and the same two weeks last year went up too → "seasonal lift"
  F1: { brand: 'SP', weeks: { [P]: cell(10, 200), [L]: cell(30, 600), [LYP]: cell(5, 100), [LY]: cell(15, 300) } },
  // G: a small rise the data does not explain
  G1: { brand: 'SP', weeks: { [P]: cell(10, 300), [L]: cell(12, 360) } },
  // small ones (everything else) — and one only last week (new)
  H1: { brand: 'SP', weeks: { [P]: cell(1, 20.25), [L]: cell(1, 15.1) } },
  H2: { brand: 'SP', weeks: { [P]: cell(2, 40), [L]: cell(2, 47.33) } },
  H3: { brand: 'SP', weeks: { [L]: cell(1, 9.99) } },
  // CPC
  K1: { brand: 'CPC', weeks: { [P]: cell(10, 500), [L]: cell(14, 700) } },
  K2: { brand: 'CPC', weeks: { [P]: cell(20, 400), [L]: cell(10, 200) } },
  // a row with no brand: in neither brand
  Z1: { brand: '', weeks: { [P]: cell(1, 1000), [L]: cell(1, 0) } },
};
const PARENT = { A1: 'PA', A2: 'PA' };
const NAMES = { PA: 'Ridhi Napkins Set of 4', B1: 'Ridhi Tablecloth 60x90 Inch', C1: 'Ridhi Table Runner', D1: 'Ridhi Placemats', E1: 'Ridhi Cushion Cover',
  F1: 'Ridhi Christmas Napkins', G1: 'Ridhi Quilt', K1: 'CPC Tablecloth', K2: 'CPC Napkins' };
// the per-day cache: A sold nothing on 19–21 Nov; everything else every day of both weeks
const dayKeys = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
const DAYS = { d: {}, from: '2026-10-10', upTo: '2026-11-22', at: '2026-11-23 05:42' };
Object.keys(ROWS).forEach(a => { DAYS.d[a] = {}; dayKeys(P, 14).forEach(day => { DAYS.d[a][day] = [1, 10]; }); });
['2026-11-19', '2026-11-20', '2026-11-21'].forEach(day => { DAYS.d.A1[day] = [0, 0]; DAYS.d.A2[day] = [0, 0]; });
const STOCK = { SP: { m: { 'A1-S': 0, 'A2-S': 0, 'C1-S': 50, 'D1-S': 9 }, at: '2026-11-23T03:00:00.000Z', skuOf: { A1: ['A1-S'], A2: ['A2-S'], C1: ['C1-S'], D1: ['D1-S'] } } };
const WEEKLY = { rows: ROWS, at: '2026-11-23 05:42' };
// the Sales Dashboard's days (sdDays): Ridhi $100 a day last week, $80 a day the same week last year; CPC $20 a day
const DAILY = { SP: {}, CPC: {} };
dayKeys(L, 7).forEach(day => { DAILY.SP[day] = [100, 2, 2]; DAILY.CPC[day] = [20, 1, 1]; });
dayKeys(LY, 7).forEach(day => { DAILY.SP[day] = [80, 2, 2]; DAILY.CPC[day] = [20, 1, 1]; });
const opts = extra => Object.assign({ weekly: WEEKLY, brand: 'SP', today: '2026-11-23', parentOf: a => PARENT[a] || a, nameOf: (p) => NAMES[p] || '', days: DAYS, stock: STOCK }, extra || {});
const cents = rows => Object.values(rows).reduce((s, r) => s + Math.round(((r.weeks[L] || {}).rev || 0) * 100) - Math.round(((r.weeks[P] || {}).rev || 0) * 100), 0);

(async () => {
  const X = load();
  console.log('== the weeks ==');
  {
    const w = X.viWeeks('2026-11-23');
    ok('Mon 23 Nov (PT): last finished week = Sun 15 – Sat 21 Nov, against 8–14 Nov; last year = 16–22 Nov 2025 (52 weeks back)', w.L === L && w.P === P && w.LY === LY && w.LYP === LYP, JSON.stringify(w));
    ok('Sun 22 Nov: the week of 15 Nov has finished (Saturday is before today) — still the same last week', X.viWeeks('2026-11-22').L === L);
    ok('labels as PPC & Organic writes them: "Nov 15-21", "Nov 29-Dec 5"', X.viLabel(L) === 'Nov 15-21' && X.viLabel('2026-11-29') === 'Nov 29-Dec 5');
  }

  console.log('== 1. the movers maths and the add-up check ==');
  const R = X.viCompute(opts());
  {
    const sp = Object.fromEntries(Object.entries(ROWS).filter(([, r]) => r.brand === 'SP'));
    ok('it works out (ok)', R.ok, R.why);
    ok(`Ridhi's change = Σ (last week − the week before) over its ASINs, to the cent: ${X.viMoney(R.total.d, true)}`, R.total.d === cents(sp), R.total.d + ' vs ' + cents(sp));
    ok('…and its % = change ÷ the week before', Math.abs(R.total.pct - R.total.d / R.total.was * 100) < 1e-9);
    ok('a parent adds its children: "Ridhi Napkins Set of 4" = A1 + A2 = −$1,200', R.movers.some(m => m.parent === 'PA' && m.d === -120000));
    ok('MOVERS + EVERYTHING ELSE = THE BRAND\'S CHANGE, in whole cents (and the check says so)', R.movers.reduce((s, m) => s + m.d, 0) + R.rest === R.total.d && R.check === true);
    ok('the movers are the biggest $ first, at most 8, at most 6 drops and 6 gains',
      R.movers.length <= 8 && R.movers.every((m, i) => !i || Math.abs(m.d) <= Math.abs(R.movers[i - 1].d)) && R.movers.filter(m => m.d < 0).length <= 6 && R.movers.filter(m => m.d > 0).length <= 6,
      R.movers.map(m => m.name + ' ' + m.d).join(' | '));
    ok('the small ones are "everything else" (H1–H3 are not bars)', !R.movers.some(m => /^H/.test(m.parent)) && R.rest !== 0 || R.movers.length === 8);
    ok('a row with no brand is in neither brand', !R.movers.some(m => m.parent === 'Z1'));
    const C = X.viCompute(opts({ brand: 'CPC' })), B = X.viCompute(opts({ brand: 'ALL' }));
    ok('Both = Ridhi + CPC, to the cent (and its own add-up check holds)', B.ok && B.total.d === R.total.d + C.total.d && B.check, [B.total.d, R.total.d, C.total.d].join(' '));
    ok('no daily history given: no last-year line (never worked out from the weekly store, which keeps no year of weeks)', R.ly === null);
    const lyR = X.viCompute(opts({ daily: DAILY }));
    ok('the same week last year from the Sales Dashboard\'s days: 15–21 Nov 2026 ($700) against 16–22 Nov 2025 ($560) → +$140 (+25.0%)',
      lyR.ly && lyR.ly.now === 70000 && lyR.ly.was === 56000 && lyR.ly.d === 14000 && lyR.ly.pct.toFixed(1) === '25.0', JSON.stringify(lyR.ly));
    ok('…a day missing from that history: no line rather than a wrong one', X.viCompute(opts({ daily: { SP: Object.fromEntries(Object.entries(DAILY.SP).slice(1)) } })).ly === null);
    ok('…Both = Ridhi + CPC days', X.viCompute(opts({ brand: 'ALL', daily: DAILY })).ly.now === 70000 + 7 * 2000);
    ok('"$X explained" = Σ of the bars; the top mover\'s share of the change in whole %',
      R.explained === R.movers.reduce((s, m) => s + m.d, 0) && R.share === Math.round(R.movers[0].d / R.total.d * 100), R.explained + ' ' + R.share);
    const flat = X.viCompute(opts({ weekly: { rows: { Q1: { brand: 'SP', weeks: { [P]: cell(5, 100), [L]: cell(5, 100) } } }, at: WEEKLY.at } }));
    ok('nothing moved: change $0, no bars, rest 0, the check still holds', flat.ok && flat.total.d === 0 && !flat.movers.length && flat.rest === 0 && flat.check);
  }

  console.log('== 2. the drivers: only what the data shows ==');
  {
    const by = p => R.movers.find(m => m.parent === p) || X.viCompute(opts()).movers.find(m => m.parent === p);
    const t = p => (by(p) || { driver: { t: '(not a mover)' } }).driver.t;
    ok('OUT OF STOCK: 0 FBA units now + days without a sale → "out of stock: 0 FBA units as of 23 Nov, 3 days without a sale"', t('PA') === 'out of stock: 0 FBA units as of 23 Nov, 3 days without a sale', t('PA'));
    const noStock = X.viCompute(opts({ stock: {} })).movers.find(m => m.parent === 'PA');
    ok('…without the stock document it is NEVER called out of stock: "3 days without a sale (0 the week before)"', noStock.driver.t === '3 days without a sale (0 the week before)', noStock.driver.t);
    const stocked = X.viCompute(opts({ stock: { SP: Object.assign({}, STOCK.SP, { m: { 'A1-S': 4, 'A2-S': 0 } }) } })).movers.find(m => m.parent === 'PA');
    ok('…and not when Amazon holds stock now (4 units): the sale-free days are said instead', stocked.driver.k === 'nosale', stocked.driver.t);
    ok('PRICE: same units, average price $20 → $23 → "price +15%"', t('B1') === 'price +15%', t('B1'));
    ok('TRAFFIC: sessions 600 → 300, spend held → "traffic −50% (sessions)"', t('C1') === 'traffic −50% (sessions)', t('C1'));
    ok('AD SPEND: $200 → $80 → "ad spend −60%" (checked before traffic, as PPC & Organic\'s cause does)', t('D1') === 'ad spend −60%', t('D1'));
    ok('CONVERSION: the same 400 sessions, units 40 → 20 → "conversion −50%"', t('E1') === 'conversion −50%', t('E1'));
    ok('SEASONAL: up 200%, and the same two weeks last year rose 200% → "seasonal lift: the same week last year rose 200%"', t('F1') === 'seasonal lift: the same week last year rose 200%', t('F1'));
    ok('NONE: a rise the data does not explain → "no clear driver"', t('G1') === 'no clear driver', t('G1'));
    const tiny = X.viCompute(opts({ weekly: { rows: { S1: { brand: 'SP', weeks: { [P]: cell(50, 1000, { spend: 100, sessions: 500 }), [L]: cell(45, 900, { spend: 85, sessions: 470 }) } } }, at: WEEKLY.at } })).movers[0];
    ok('small moves under the thresholds (spend −15%, sessions −6%) name nothing', tiny.driver.k === 'none', tiny.driver.t);
    const newOne = X.viDriver({ asins: ['N1'], brand: 'SP', c: { L: cell(3, 60), P: {}, LY: {}, LYP: {} } }, 6000, { wk: X.viWeeks('2026-11-23'), days: null, stock: null });
    ok('a product with no sales the week before: "no sales the week before"', newOne.k === 'new', newOne.t);
  }

  console.log('== 3. not finished / not there: said, never guessed ==');
  {
    const early = X.viCompute(opts({ weekly: { rows: ROWS, at: '2026-11-22 05:42' } }));
    ok('the store written before Saturday (PT) ended — Sunday 05:42 in India: "not complete … yet", no numbers', !early.ok && /not complete/.test(early.why), early.why);
    ok('…from Sunday 14:00 (India) it counts', X.viCompute(opts({ weekly: { rows: ROWS, at: '2026-11-22 14:00' } })).ok);
    ok('an empty store: said', !X.viCompute(opts({ weekly: { rows: {}, at: '' } })).ok);
    const noPrev = X.viCompute(opts({ weekly: { rows: { A1: { brand: 'SP', weeks: { [L]: cell(1, 10) } } }, at: WEEKLY.at } }));
    ok('the week before missing: said ("does not hold both")', !noPrev.ok && /does not hold both/.test(noPrev.why), noPrev.why);
  }

  console.log('== 4. the number check on Claude\'s text ==');
  {
    const facts = X.viAiFacts(R);
    const ruleText = X.viRuleText(R);
    ok('the rule-written summary passes its own check (every number in it is in the facts)', X.viNumbersOk(ruleText, facts), ruleText);
    ok('…and says how much of the change the top mover is', new RegExp(R.share + '% of the fall').test(ruleText), ruleText);
    const top = R.movers[0];
    const goodAi = `${facts.brand} revenue fell ${facts.change} (${facts.changePct}) in ${facts.week}. ${top.name} alone is ${facts.topMoverShare} of the fall — ${top.driver.t}.`;
    ok('a Claude text using only the numbers sent passes', X.viNumbersOk(goodAi, facts), goodAi);
    ok('a made-up number fails ("$5,000")', !X.viNumbersOk(goodAi + ' Expect $5,000 back next week.', facts));
    ok('a rounded number fails ("$1.6k" for $1,571)', !X.viNumbersOk(`${facts.brand} revenue fell $1.6k.`, facts));
    ok('a new percentage fails ("45% of it")', !X.viNumbersOk(`Napkins were 45% of it.`, facts));
    ok('an empty text fails', !X.viNumbersOk('', facts));
    ok('Claude is sent ONLY the computed movers (brand, weeks, change, %, share, movers: name / change / % / driver, everything else)',
      Object.keys(facts).join() === 'brand,week,weekBefore,direction,change,changePct,topMoverShare,movers,everythingElse'
      && facts.movers.every(m => Object.keys(m).join() === 'name,change,changePct,driver'), JSON.stringify(facts).slice(0, 200));
  }

  console.log('== 5. the fallback: the box always has a summary ==');
  {
    const Y = load();
    const R2 = Y.viCompute(opts());
    const s0 = Y.viSummary(R2);
    ok('no Claude answer (AI off, failed, not asked): the rule-written sentence, marked "Summary"', s0.by === 'rules' && s0.text === Y.viRuleText(R2));
    const key = Y.viAiKey(R2), f = Y.viAiFacts(R2);
    Y.viKeptSet(key, { text: `Revenue fell ${f.change} (${f.changePct}); the napkins were ${f.topMoverShare} of it.` });
    const s1 = Y.viSummary(R2);
    ok('a kept Claude answer whose numbers check: shown as the "Claude summary"', s1.by === 'claude' && /napkins/.test(s1.text), JSON.stringify(s1));
    Y.viKeptSet(key, { text: 'Revenue fell $12,345 because of the weather.' });
    const s2 = Y.viSummary(R2);
    ok('a kept answer naming a number that is not in the movers: the rule sentence instead, and it says why', s2.by === 'rules' && /not in the movers/.test(s2.why), JSON.stringify(s2));
    const other = Y.viCompute(opts({ weekly: { rows: Object.assign({}, ROWS, { B1: { brand: 'SP', weeks: { [P]: cell(50, 1000), [L]: cell(50, 1300) } } }), at: WEEKLY.at } }));
    ok('other movers (a nightly run restated a day) → another key: the kept answer is not reused', Y.viAiKey(other) !== key);
    ok('the same movers → the same key (Refresh never asks Claude again)', Y.viAiKey(Y.viCompute(opts())) === key);
  }

  console.log('== 6. the chapter "This week, explained." and the Dashboard card ==');
  let html = '', htmlOpen = '';
  {
    const Z = load();
    Z.VI.data = { weekly: WEEKLY, days: DAYS, stock: STOCK };
    Z.ctx.wParentOf = a => PARENT[a] || a;
    Z.ctx.PNAME = { SP: { PA: { v: NAMES.PA } } };
    Z.ctx.wTitle = a => NAMES[a] || '';
    Z.ctx.SD = { d: DAILY }; Z.ctx.sdDays = ch => DAILY[ch];
    const res = Z.viFor('SP'), sum = Z.viSummary(res);
    html = Z.viBoxHtml(res, sum, 'SP', false);
    htmlOpen = Z.viBoxHtml(res, sum, 'SP', true);
    const text = strip(html), open = strip(htmlOpen);
    const fell = X.viMoney(Math.abs(R.total.d));
    ok(`the headline with real numbers: "Revenue fell ${fell}" and a red ▼ badge "▼ 29.3%" (the preview's)`,
      text.startsWith(`Revenue fell ${fell} ▼ 29.3%`) && /class="sdx-delta down"/.test(html), text.slice(0, 100));
    ok('…the weeks under it: "Nov 15–21 vs Nov 8–14 · Ridhi"', text.includes('Nov 15–21 vs Nov 8–14 · Ridhi'));
    ok('…"Summary" (rule-written until Claude is deployed) and the summary itself', text.includes('Summary ' + sum.text) && /class="sdx-by">Summary</.test(html));
    ok('CLOSED by default: "Show details ▾", the details hidden', text.includes('Show details ▾') && /class="sdx-more" id="viDet" hidden/.test(html) && /aria-expanded="false"/.test(html));
    ok('OPEN: "Hide details ▴" and the details: everything else, last year, $ explained, drivers named, as of',
      open.includes('Hide details ▴') && open.includes('Everything else: +$2 from 2 other products · Same week last year: +25.0% · −$1.8k explained (100%) by 8 movers · 7 drivers named · as of 23 Nov 05:42'), open.slice(-260));
    ok('the sources are behind the ⓘ only (its tooltip), never as text', /class="sdx-i"[^>]*title="From PPC weekly sales: the Orders workbooks per ASIN/.test(htmlOpen) && !/Orders workbooks/.test(open) && /FBA stock as of Ridhi 23 Nov/.test(htmlOpen));
    ok('"▲ Biggest gains" and "▼ Biggest drops" on the right', text.includes('▲ Biggest gains') && text.includes('▼ Biggest drops'));
    const gains = res.movers.filter(m => m.d > 0), drops = res.movers.filter(m => m.d < 0);
    ok('one row per mover in its column (gains green, drops red)', (html.match(/class="sdx-mv up"/g) || []).length === gains.length && (html.match(/class="sdx-mv down"/g) || []).length === drops.length);
    ok('each row: the name and its $ — "Ridhi Napkins Set of 4 −$1,200"', /Ridhi Napkins Set of 4 −\$1,200/.test(text), text.slice(0, 600));
    ok('…a bar scaled to the biggest mover (100% for it, the others less)', /<i style="width:100%"><\/i>/.test(html) && /<i style="width:50%">/.test(html));
    ok('driver pills, at most 2 a row: "ad spend ↓60%", "traffic ↓50%", "price ↑15%", "seasonal", "no clear driver"',
      ['ad spend ↓60%', 'traffic ↓50%', 'price ↑15%', '>seasonal<', 'no clear driver'].every(p => html.includes(p))
      && html.split('class="sdx-mv ').slice(1).every(r => (r.split('class="sdx-mv ')[0].match(/class="vi-pill /g) || []).length <= 2));
    ok('…green up, red down, grey neutral', /vi-pill is-dn" title="traffic −50% \(sessions\)"/.test(html) && /vi-pill is-up" title="price \+15%"/.test(html) && /vi-pill is-flat" title="no clear driver"/.test(html));
    ok('"3 days no sale" pill when that is the driver', /3 days no sale/.test(Z.viBoxHtml(Z.viCompute(opts({ stock: {} })), sum, 'SP', true)));
    ok('the full name and every figure on hover', /title="Ridhi Napkins Set of 4: \$2,000 → \$800 \(−60%\) · out of stock: 0 FBA units as of 23 Nov, 3 days without a sale/.test(html));
    ok('the numbers are the same as before (the movers, the change, the summary)', res.total.d === R.total.d && res.movers.length === R.movers.length && sum.text === Z.viRuleText(res));
    const d = Z.viDashOf('SP');
    ok('the Dashboard card: the headline, its % and the first sentence', d.head === `Revenue fell ${fell} last week` && d.pct === -29.3 && !d.up && d.text === Z.viRuleText(res).split('. ')[0] + '.', JSON.stringify(d));
    const shop = strip(Z.viBoxHtml({ ok: false, why: 'Per-product weekly figures exist for the Amazon accounts only — pick Ridhi, CPC or All.' }, null, 'SP', false));
    ok('Shopify / not ready: the title and why, no numbers', /^This week in plain English Per-product weekly figures/.test(shop) && !/\$/.test(shop), shop);
    ok('no "sample" in the chapter', !/sample/i.test(htmlOpen));
  }

  console.log('== 7. the backend (Pricing-API/SalesAI.gs) with a fake Claude ==');
  {
    const GS = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'SalesAI.gs'), 'utf8');
    const props = { CLAUDE_API_KEY: 'k' }, calls = [], logs = [];
    let answer = '';
    const B = vm.createContext({ JSON, Math, Number, String, Object, Array, isFinite, Date,
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
      CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }, AI_CACHE_S: 21600,
      prop_: k => (k in props ? props[k] : null), aiObj_: p => ({ type: 'object', properties: p }), aiCut_: (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 120),
      aiHash_: s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return String(h); },
      aiMonth_: () => ({ usd: 1, limit: 50 }), aiRound_: x => x, aiCost_: () => 0.001, aiSpend_: () => ({ usd: 1.001, limit: 50 }),
      aiLog_: (...a) => logs.push(a), aiClaude_: (model, def, user, img, system) => { calls.push({ model, user, system }); return { ok: true, json: { summary: answer }, model, usage: { input_tokens: 1 } }; } });
    vm.runInContext(GS, B);
    const facts = JSON.parse(JSON.stringify(X.viAiFacts(R)));
    const who = { email: 'a@b' };
    answer = `Ridhi revenue fell ${facts.change} (${facts.changePct}) in ${facts.week}; ${facts.movers[0].name} was ${facts.topMoverShare} of it.`;
    const a1 = B.saiInsight_({ brand: 'SP', week: L, facts }, who);
    ok('a summary whose numbers are all in the movers: returned, on AI_MODEL_FAST (Haiku by default), logged', a1.ok && a1.text === answer && calls.length === 1 && calls[0].model === 'claude-haiku-5-5' && logs.length === 1, JSON.stringify(a1));
    ok('…Claude was sent ONLY the cleaned movers, with its own short system prompt', /TASK: sales_insight/.test(calls[0].user) && !/rows|asin/i.test(calls[0].user) && /Copy every number EXACTLY/.test(calls[0].system));
    const a2 = B.saiInsight_({ brand: 'SP', week: L, facts }, who);
    ok('the same movers again: the kept text, no second call (one per brand per week)', a2.ok && a2.cached && calls.length === 1);
    const other = JSON.parse(JSON.stringify(facts)); other.change = '$1,999';
    const a3 = B.saiInsight_({ brand: 'SP', week: L, facts: other }, who);
    ok('other figures for a week already written: NO new call — the kept text comes back for Sellora to check', !a3.ok && a3.kept === answer && calls.length === 1);
    answer = 'Revenue fell $12,345 because of the weather.';
    const a4 = B.saiInsight_({ brand: 'CPC', week: L, facts }, who);
    ok('a summary with a number not in the movers is refused (and not kept)', !a4.ok && /number that is not in the movers/.test(a4.error) && !JSON.parse(props.SAI_KEEP)['CPC|' + L]);
    ok('not signed in / a wrong brand / no movers / AI not set up: refused before any call',
      !B.saiInsight_({ brand: 'SP', week: L, facts }, {}).ok && !B.saiInsight_({ brand: 'XX', week: L, facts }, who).ok
      && !B.saiInsight_({ brand: 'ALL', week: L, facts: { brand: 'Ridhi' } }, who).ok && (() => { delete props.CLAUDE_API_KEY; return !B.saiInsight_({ brand: 'ALL', week: L, facts }, who).ok; })() && calls.length === 2);
    ok('the backend\'s number check is the same as the page\'s', B.saiNumbersOk_(answer, facts) === X.viNumbersOk(answer, facts) && B.saiNumbersOk_(X.viRuleText(R), facts) === true);
  }

  console.log('\n== SAMPLE: the box on the test data (Ridhi) ==');
  console.log(strip(htmlOpen.replace(/<\/(div|h2|h3|p|li|section)>/g, '\n')).replace(/ ?\n ?/g, '\n'));
  if (process.argv.includes('--html')) { const out = process.argv[process.argv.indexOf('--html') + 1]; fs.writeFileSync(out, html); fs.writeFileSync(out.replace(/[.]html$/, '-open.html'), htmlOpen); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
