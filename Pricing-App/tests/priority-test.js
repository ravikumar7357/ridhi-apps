/* Priority labels (20 Nov 2026): src/app/listing/listing-priority.js — 🔴 Critical · 🟠 Important · ⚪ Can wait — the one shared rule,
 * over the rule-pin mock catalogue (1,000 listings) and the big one (4,400), in a stub page.
 *   node tests/priority-test.js
 * Checks: each rule → the right label; stock 0 / not live → Can wait; the screen chip and the download cell come from the same function on
 * every screen; it works with no AI key (no AI file needed); no count changes (every listing's checks and every page's counts the same
 * with and without the file); the order inside a level (sales, or stock when sales are old); the filter chips; the numbers per level. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
const { mixedPage } = require('./rule-pin-test.js');
const { bigPage } = require('./smooth-bench.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const SRC = path.join(__dirname, '..', 'src', 'app', 'listing');

console.log('== the rule ==');
{
  const C = load({ pr: true });
  const L = o => C.prLevel(o);
  const cases = [
    [{ stock: 5, problems: ['amazon_error'] }, 'crit', 'stock + an Amazon error'],
    [{ stock: 5, problems: ['amazon_suppressed'] }, 'crit', 'stock + suppressed / hidden from search'],
    [{ stock: 5, problems: ['no_main_image'] }, 'crit', 'stock + no main picture'],
    [{ stock: 5, problems: ['tm'] }, 'crit', "stock + another brand's name (trademark)"],
    [{ stock: null, live: true, problems: ['amazon_suppressed'] }, 'crit', 'stock not known but live + suppressed'],
    [{ stock: 3, problems: ['aplus_missing'] }, 'imp', 'stock + A+ missing'],
    [{ stock: 3, problems: ['aplus_draft'] }, 'imp', 'stock + A+ draft'],
    [{ stock: 3, problems: ['keyword_bytes'] }, 'imp', 'stock + search terms over 249 bytes'],
    [{ stock: 3, problems: ['title_template'] }, 'imp', 'stock + the title breaks a company rule'],
    [{ stock: 3, problems: ['images_below'] }, 'imp', 'stock + too few pictures'],
    [{ stock: 3, problems: ['cat_mixed'] }, 'imp', 'stock + a wrong category'],
    [{ stock: 3, problems: ['aplus_missing', 'amazon_error'] }, 'crit', 'Critical wins over Important'],
    [{ stock: 0, problems: ['amazon_error', 'no_main_image'] }, 'wait', '0 stock → Can wait, whatever the problem'],
    [{ stock: null, live: false, problems: ['amazon_error'] }, 'wait', 'not live, stock not known → Can wait'],
    [{ stock: 9, problems: [] }, 'wait', 'only "Good to fill" (no problem key) → Can wait'],
    [{ stock: 9, problems: ['claim', 'desc_below'] }, 'wait', 'a problem the rule does not name → Can wait'],
  ];
  const bad = cases.filter(([o, want]) => L(o) !== want).map(([o, want, why]) => `${why}: ${L(o)} (want ${want})`);
  ok(`every rule gives the right label (${cases.length} cases)`, !bad.length, bad.join(' | '));
  ok('the words: "🔴 Critical — fix today", "🟠 Important — this week", "⚪ Can wait"', C.prCsv('crit') === 'Critical — fix today' && C.prCsv('imp') === 'Important — this week' && C.prCsv('wait') === 'Can wait'
    && /🔴 Critical/.test(C.prChipHtml('crit')) && /🟠 Important/.test(C.prChipHtml('imp')) && /⚪ Can wait/.test(C.prChipHtml('wait')));
  ok('the filter chips: none chosen = every listing; one chosen = that level only; pressed again = off', C.prKeep('x', 'imp') && C.prToggle('x', 'crit') === 'crit' && !C.prKeep('x', 'imp') && C.prKeep('x', 'crit') && C.prToggle('x', 'crit') === '' && C.prKeep('x', 'wait'));
  ok('…drawn in the screen\'s own chip markup', /data-z="crit"[^>]*>🔴 Critical/.test(C.prFilterHtml('y', (k, label, on) => `<b data-z="${k}"${on ? ' on' : ''}>${label}</b>`)));
}

console.log('== the order inside a level: sales, or stock when the sales are old ==');
{
  const items = [{ s: 'a', k: 'imp', asin: 'A1', stock: 50 }, { s: 'b', k: 'crit', asin: 'B1', stock: 1 }, { s: 'c', k: 'imp', asin: 'C1', stock: 5 }, { s: 'd', k: 'wait', asin: 'D1', stock: 99 }];
  const sales = { A1: 10, B1: 0, C1: 900, D1: 5000 };
  const fresh = load({ pr: true, ctx: { apcSales: a => sales[a], apcSalesAt: () => '2026-11-19 13:00', apcSalesOld: () => '' } });
  ok('Critical first, then Important by 30-day sales (C 900 before A 10), then Can wait', fresh.prSort(items, x => x).map(x => x.s).join('') === 'bcad');
  const old = load({ pr: true, ctx: { apcSales: a => sales[a], apcSalesAt: () => '2026-11-01 13:00', apcSalesOld: () => '1 Nov' } });
  ok('sales data older than 7 days: "sales data old" → ordered by stock (A 50 before C 5)', !!old.prSalesOld() && old.prSort(items, x => x).map(x => x.s).join('') === 'bacd');
  const none = load({ pr: true });
  ok('no sales pulled at all → by stock too', none.prSalesOld() === 'no sales data' && none.prSort(items, x => x).map(x => x.s).join('') === 'bacd');
}

console.log('== the same function on the screen and in the download, on every screen ==');
{
  const src = f => fs.readFileSync(path.join(SRC, f), 'utf8');
  const pairs = [['listing-workspace.js', 'prKid(kid)', 'prCsv(prKid(kid))'], ['image-manager.js', 'prIm(', 'prCsv(prIm(brand, item))'], ['aplus-audit.js', 'prChipHtml(prApc(p)', 'prCsv(prApc(shown[i]))'],
    ['ip-guard.js', 'prChipHtml(prIpg(p)', 'prCsv(prIpg(p))'], ['family-check.js', 'prChipHtml(prFc(r)', 'prCsv(prFc(r))'], ['category-check.js', 'prChipHtml(prCc(r)', 'prCsv(prCc(r))']];
  const miss = pairs.filter(([f, chip, csv]) => !src(f).includes(chip) || !src(f).includes(csv)).map(([f]) => f);
  ok('Workspace, Image Manager, A+ Content, IP Guard, Family check, Categories: the chip and the download\'s "Priority" cell call the same helper', !miss.length, miss.join(', '));
  ok('Listing Health (Why column, the side panel) and Listing Errors draw the chip with the same prOf', /prChipHtml\(prOf\(row\.brand, row\.sku/.test(src('listing-health-data.js')) && /prChipHtml\(prKid\(kid\)\)/.test(src('listing-kid.js'))
    && /prChipHtml\(prLe\(brand, x\)\)/.test(src('listing-errors.js')));
  const cols = [['listing-workspace.js', 'LI_WS_DL_COLS'], ['image-manager.js', 'IM_DL_COLS'], ['aplus-audit.js', 'APC_CSV_COLS'], ['ip-guard.js', 'IPG_CSV_COLS'], ['family-check.js', 'FC_CSV_COLS'], ['category-check.js', 'CC_CSV_COLS']];
  const noCol = cols.filter(([f, c]) => !new RegExp(`const ${c} = [^;]*'Priority'\\]`).test(src(f).replace(/\r?\n\s*/g, ' '))).map(([f]) => f);
  ok('every download has the "Priority" column — at the end, so no other column moves', !noCol.length, noCol.join(', '));
  ok('the priority file needs no AI: no aiAsk, no fetch, no backend call', !/aiAsk|fetch\(|baCall|imPost|getDoc|setDoc/.test(src('listing-priority.js')));
}

console.log('== no count changes; the numbers per level on the test data ==');
{
  const sig = C => ['SP', 'CPC'].map(b => C.HEALTH[b].rows.map(r => { const h = C.healthOf(Object.assign({}, r, { brand: b }), C.hCtx()); return [r.sku, h.bucket, h.found.map(x => x.id).join('+')].join(':'); }).join(' ')).join(' | ');
  const A = mixedPage(undefined), B = mixedPage(undefined, { pr: true });
  ok(`rule-pin catalogue (${A.HEALTH.SP.rows.length + A.HEALTH.CPC.rows.length} listings): every listing's checks and every count are the same with the priority file`,
    sig(A) === sig(B) && JSON.stringify(A.counts('SP')) === JSON.stringify(B.counts('SP')) && JSON.stringify(A.counts('CPC')) === JSON.stringify(B.counts('CPC')));
  const n = B.prReport();
  const all = ['SP', 'CPC'].reduce((s, b) => s + n[b].crit + n[b].imp + n[b].wait + n[b].noProblem, 0);
  ok('…every listing gets one level (or has no problem)', all === B.HEALTH.SP.rows.length + B.HEALTH.CPC.rows.length, JSON.stringify(n));
  console.log('     mixed 1,000:', JSON.stringify(n));
  const G = bigPage({ load: { pr: true } });
  const g = G.prReport();
  console.log('     big 4,400:  ', JSON.stringify(g));
  // the counts follow the data exactly: Critical = in stock (or live) with an Amazon error / suppressed / no main picture
  const crit = X => ['SP', 'CPC'].reduce((s, b) => s + X.HEALTH[b].rows.filter(r => {
    const f = X.healthOf(Object.assign({}, r, { brand: b }), X.hCtx()).found.map(h => h.detector);
    const has = r.qty != null ? r.qty > 0 : /active/i.test(r.status || '') && !/inactive/i.test(r.status || '');
    return has && f.some(d => ['amazon_error', 'amazon_suppressed', 'no_main_image'].includes(d));
  }).length, 0);
  ok(`the big catalogue too: Important and Can wait found; Critical = exactly the listings in stock with an Amazon error, suppression or no main picture (${crit(G)} here)`,
    ['SP', 'CPC'].some(b => g[b].imp > 0) && ['SP', 'CPC'].some(b => g[b].wait > 0) && g.SP.crit + g.CPC.crit === crit(G) && n.SP.crit + n.CPC.crit === crit(B), JSON.stringify(g));
  ok('…works with no AI key: no AI file loaded, nothing asked of the backend', typeof G.aiAsk === 'undefined' || G.aiAsk === null);
  module.exports = { mixed: n, big: g };
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
