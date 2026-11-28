/* Parent Listing Review (src/app/sales/parent-listing-review.js) + its interactive layer (plr-insights.js, 28 Nov 2026) in a stub page.
 *   node tests/plr-test.js
 * The table — rows, cells, the TOTAL row, every sort and filter — is the SAME as before this change (9fdacedd), and Export writes the
 * same file (every row, not only the 15 shown). Then: the top 15 + "Show other N" / "Show fewer", a search over all parents, the cards
 * = the existing plAction names (counts, filter, top 3), the story and KPIs from the rows, the 📅 week picker (= the old page on that
 * week), the side panel (opens on a row click, ✕, Esc, outside click; children, rank, + Task), ✨ off. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 600) : '')); } };
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', f), 'utf8');
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* ---- the dates: today Sat 28 Nov 2026 → this week starts Sun 22 Nov; 10 completed weeks, the last one 15–21 Nov ---- */
const sdShift = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const wKeyOfDate = d => { const t = new Date(d + 'T00:00:00Z'); return sdShift(d, -t.getUTCDay()); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wLabel = w => { const e = sdShift(w, 6); return `${MON[+w.slice(5, 7) - 1]} ${+w.slice(8)}–${+e.slice(8)}`; };
const WEEKS = Array.from({ length: 10 }, (x, i) => sdShift('2026-11-15', -7 * (9 - i)));
const LAST = WEEKS[9];

/* ---- the fixture: 40 parents (30 Ridhi, 10 CPC), each with 2 children; built to hit every action ---- */
function fixture() {
  const HEALTH = { SP: { rows: [] }, CPC: { rows: [] } }, rows = {}, parentOf = {}, BSR = { SP: {}, CPC: {} };
  const B1 = '2026-11-10', B2 = '2026-11-17';
  BSR.SP[B1] = {}; BSR.SP[B2] = {}; BSR.CPC[B1] = {}; BSR.CPC[B2] = {};
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const brand = i < 30 ? 'SP' : 'CPC', p = 'P' + String(i).padStart(3, '0');
    // per parent, per week (both kids together): { rev, u, sessions, pv, spend }, and the stock
    let lw = { rev: 400 + 30 * (40 - i), u: 20, sessions: 600, pv: 900, spend: 40 }, avg = Object.assign({}, lw), stock = 300;
    if (i <= 3) { stock = 0; }                                                   // Restock — out
    else if (i <= 6) { lw.u = 60; stock = 60; }                                  // Restock — low (60 / 60 / 4.33 months)
    else if (i <= 9) { lw.sessions = 100; avg.sessions = 1000; }                 // Traffic drop
    else if (i === 10) { lw.sessions = 1000; lw.u = 5; avg.sessions = 1000; }    // Fix the page (0.5%)
    else if (i === 11) { lw.rev = 0; lw.u = 0; lw.spend = 50; lw.sessions = 200; avg.sessions = 250; }   // Cut spend (under 300 sessions: no page verdict)
    else if (i <= 13) { lw.rev = 100; lw.spend = 60; }                           // Spend too high
    else if (i === 14) { lw.spend = 0; stock = 2000; }                           // Add budget
    else if (i <= 16) { stock = 2000; avg.rev = lw.rev * 1.6; }                  // Overstocked (sales falling)
    if (i === 20) avg.rev = lw.rev * 2.5;                                        // a steady one with a big drop (not a problem by the rules)
    if (i >= 35) { lw.spend = null; avg.spend = null; }                          // CPC: no ad report for some
    ['A', 'B'].forEach((k, j) => {
      const asin = p + k;
      parentOf[asin] = p;
      HEALTH[brand].rows.push({ sku: `${p}-${k}`, asin, parent: p, qty: stock / 2, title: `Name ${p} child`, color: ['Red', 'Blue'][j], size: ['60x84', '60x102'][j] });
      const weeks = {};
      WEEKS.forEach((w, wi) => {
        const src = w === LAST ? lw : avg, f = 0.85 + rnd() * 0.3;
        weeks[w] = { rev: Math.round(src.rev / 2 * (w === LAST ? 1 : f) * 100) / 100, u: Math.round(src.u / 2), sessions: Math.round(src.sessions / 2), pv: Math.round(src.pv / 2) };
        if (src.spend != null) weeks[w].spend = Math.round(src.spend / 2 * 100) / 100;
        if (wi === 0 && i === 5) delete weeks[w].sessions;                       // an unknown session week
      });
      rows[asin] = { brand, weeks };
    });
    // ranks: the older snapshot, then the newer; parents 0–9 got clearly worse
    BSR[brand][B1][p] = { rank: 20000 + i * 100, cat: 'Home & Kitchen', sub: 1000 + i * 50, subCat: 'Tablecloths' };
    BSR[brand][B2][p] = { rank: 20000 + i * 100, cat: 'Home & Kitchen', sub: i <= 9 ? 3100 + i : 1000 + i * 50, subCat: 'Tablecloths' };
  }
  return { HEALTH, WEEKLY: { weeks: WEEKS.slice(), rows }, parentOf, BSR, BSR_WEEKS: { SP: [B1, B2], CPC: [B1, B2] } };
}

function load(srcText, opts) {
  opts = opts || {};
  const F = fixture();
  const els = {};
  const cl = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  const el = id => els[id] || (els[id] = { id, value: { plBrand: 'ALL', plType: 'ALL', plAct: 'TODO', plFilter: '' }[id] || '', innerHTML: '', textContent: '', className: '', title: '', dataset: {}, style: { setProperty() {} },
    classList: cl(), hidden: id === 'plxPanel', isConnected: true, _on: {}, addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); }, querySelectorAll: () => [], querySelector: () => null, focus() {} });
  els.plCardModal = el('plCardModal'); els.plCardModal.classList.add('hide');
  const blobs = [], docOn = {}, tasks = [], charts = [];
  const ctx = {
    $: el, document: { getElementById: el, addEventListener(t, fn, cap) { const l = docOn[t] = docOn[t] || []; if (cap) l.unshift(fn); else l.push(fn); }, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }), documentElement: {} },
    window: { echarts: { init: () => ({ setOption: o => charts.push(o), dispose() {}, resize() {} }) }, addEventListener() {} },
    CSS: { escape: s => s }, getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static' }), matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 0, setTimeout: () => 0,
    Blob: class { constructor(parts) { blobs.push(parts.join('')); } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    HEALTH: F.HEALTH, WEEKLY: F.WEEKLY, BSR: F.BSR, BSR_WEEKS: F.BSR_WEEKS, D_IMG: {}, LAUNCH: { SP: { P025: { launch: '2026-10-01' } } }, BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' },
    H_LOADED: true, PNAME_LOADED: true, BSR_LOADED: true, W_BUSY: false, W_NIGHT_RUN: Date.now(),
    loadHealthCache: async () => {}, loadParentNames: async () => {}, loadLaunch: async () => {}, loadBsrCache: async () => {}, loadDeals: async () => {}, loadWeekly: async () => {}, wNightly: async () => {},
    adBrands: () => ['SP', 'CPC'], myBrands: () => ['SP', 'CPC'], parentName: (b, p) => 'Name ' + p, wParentOf: a => F.parentOf[a] || a,
    wAddCell: (into, c) => ['rev', 'u', 'sessions', 'pv', 'spend'].forEach(k => { if (c[k] != null) into[k] = (into[k] || 0) + c[k]; }),
    wLabel, wKeyOfDate, sdShift, sdToday: () => opts.today || '2026-11-28', wWeeksList: () => WEEKS.slice(), wRenderCheck() {},
    allWeeks: () => [...new Set([...F.BSR_WEEKS.SP, ...F.BSR_WEEKS.CPC])].sort(),
    bsrMove: (a, b) => (!(a > 0) || !(b > 0) ? null : Math.abs(a - b) / b >= 0.15 && Math.abs(a - b) >= 200 ? (a > b ? 'worse' : 'better') : 'stable'),
    pollReport: async () => ({}), saveStockDoc: async () => {}, stockInMap: () => ({}),
    tkBtnHtml: (o, cls, label) => { tasks.push(o); return `<button type="button" class="tk-new" data-tk-new="x">${label}</button>`; },
    sdcFxSaved: () => opts.fx !== false, sdcLoadCharts: () => Promise.resolve(true),
    showTab: t => (ctx._tab = t), hFocusOpen() {}, AL: {}, BSX: {},
  };
  const tail = '\n;return { renderPlaudit, plRows, ensurePlaudit, R: () => PL_RENDER, setSort: (k, d) => { PL_SORT = { k, dir: d }; }'
    + (opts.plx ? ', PLX, plxModel, plxLimit, plxPanelOpen, plxPanelClose, plxFx, PLX_CARDS' : '') + ' };';
  const api = new Function(...Object.keys(ctx), srcText + tail)(...Object.values(ctx));
  const fire = (t, e) => (docOn[t] || []).forEach(fn => fn(e));
  return Object.assign(api, { el, els, blobs, docOn, fire, tasks, charts, ctx, F });
}
const NOW = o => load(SRC('parent-listing-review.js') + '\n;' + SRC('plr-insights.js'), Object.assign({ plx: true }, o || {}));
let OLD = null;
try { OLD = cp.execSync('git show 9fdacedd:Pricing-App/src/app/sales/parent-listing-review.js', { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { OLD = null; }
const noRowAttr = h => String(h).replace(/<tr data-pl-row="[^"]*">/g, '<tr>');
const bodyRows = h => (String(h).split('<tbody>')[1] || '').split('<tr').length - 1;
const target = (sel, data) => ({ closest: s => (sel.some(x => s.split(',').map(y => y.trim()).includes(x)) ? { dataset: data || {} } : null) });
const flush = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('== 1. the table is the same as before (9fdacedd): rows, cells, TOTAL; every filter and sort; Export the same file ==');
  if (!OLD) ok('(the file before this change, 9fdacedd, is not in this checkout — skipped)', true);
  else {
    const cases = [];
    for (const brand of ['ALL', 'SP', 'CPC']) for (const act of ['TODO', 'ALL', 'Restock — out', 'Steady']) cases.push({ brand, act, type: 'ALL', q: '' });
    cases.push({ brand: 'ALL', act: 'ALL', type: 'New', q: '' }, { brand: 'ALL', act: 'ALL', type: 'ALL', q: 'p01' }, { brand: 'SP', act: 'ALL', type: 'ALL', q: 'zzz' });
    const sorts = [['runRate', -1], ['title', 1], ['diff', 1], ['lwSpend', -1], ['dos', -1]];
    let same = 0, n = 0, bad = '';
    for (const c of cases) for (const [k, d] of sorts) {
      const O = load(OLD), N = NOW();
      for (const X of [O, N]) { X.el('plBrand').value = c.brand; X.el('plAct').value = c.act; X.el('plType').value = c.type; X.el('plFilter').value = c.q; X.setSort(k, d); }
      N.PLX.all = true;
      O.renderPlaudit(); N.renderPlaudit();
      n++;
      const a = O.el('plTable').innerHTML, b = noRowAttr(N.el('plTable').innerHTML);
      if (a === b && O.el('plMsg').textContent === N.el('plMsg').textContent && O.el('plMsg').title === N.el('plMsg').title) same++;
      else if (!bad) bad = JSON.stringify(c) + ' ' + k;
    }
    ok(`the table HTML (head, TOTAL row, every row and cell) and the week line are identical in ${n} filter × sort cases`, same === n, bad);
    // the default view: the TOTAL row covers every parent of the filter, though 15 rows are drawn
    const O = load(OLD), N = NOW();
    O.el('plAct').value = 'ALL'; N.el('plAct').value = 'ALL';
    O.renderPlaudit(); N.renderPlaudit();
    const subt = h => (h.match(/<tr class="subtot">[\s\S]*?<\/tr>/) || [''])[0];
    ok('the TOTAL row (40 parents) is the same while only the top 15 are drawn', subt(O.el('plTable').innerHTML) === subt(N.el('plTable').innerHTML) && /40 parents/.test(subt(N.el('plTable').innerHTML)) && bodyRows(N.el('plTable').innerHTML) === 15);
    ok('…and the 15 drawn are the first 15 of the old table, in the same order', noRowAttr(N.el('plTable').innerHTML).split('<tbody>')[1].split('</tr>').slice(0, 15).join('</tr>') === O.el('plTable').innerHTML.split('<tbody>')[1].split('</tr>').slice(0, 15).join('</tr>'));
    O.el('plExport').onclick(); N.el('plExport').onclick();
    ok('Export writes the same file as before — every row (40 + heading + TOTAL), not only the 15 shown', O.blobs[0] === N.blobs[0] && N.blobs[0].split('\r\n').length === 42, N.blobs[0] && N.blobs[0].split('\r\n').length);
    ok('the PL_RENDER rows (the parent card, Export) are all 40', N.R().rows.length === 40 && N.R().total.n === 40);
  }

  console.log('== 2. top 15 + "Show other N parents ▾" / "Show fewer ▴"; a search finds every parent ==');
  {
    const N = NOW();
    N.el('plAct').value = 'ALL';
    N.renderPlaudit();
    ok('15 rows by default, "Show other 25 parents ▾" under the table', bodyRows(N.el('plTable').innerHTML) === 15 && /Show other 25 parents ▾/.test(N.el('plMore').innerHTML), N.el('plMore').innerHTML);
    N.fire('click', { target: target(['#panePlaudit', '[data-plx]'], { plx: 'more' }) });
    ok('"Show other N" → all 40 rows and "Show fewer ▴"', bodyRows(N.el('plTable').innerHTML) === 40 && /Show fewer ▴/.test(N.el('plMore').innerHTML));
    N.fire('click', { target: target(['#panePlaudit', '[data-plx]'], { plx: 'fewer' }) });
    ok('"Show fewer" → 15 again', bodyRows(N.el('plTable').innerHTML) === 15);
    const order = N.R().rows.map(r => r.parent);
    const deep = order[33];
    N.el('plFilter').value = deep.toLowerCase();
    N.renderPlaudit();
    ok(`a search finds a parent far below the top 15 (${deep}, row 34)`, bodyRows(N.el('plTable').innerHTML) === 1 && N.el('plTable').innerHTML.includes(`data-pl-row="${N.R().rows[0].brand}|${deep}"`));
    N.el('plFilter').value = 'name p00';
    N.renderPlaudit();
    ok('a search with 10 matches shows all 10, no "Show other"', bodyRows(N.el('plTable').innerHTML) === 10 && !/Show other/.test(N.el('plMore').innerHTML));
    N.el('plAct').value = 'TODO';
    N.el('plFilter').value = 'name p02';
    N.renderPlaudit();
    ok('a search under "Needs attention": "N more parents match under other actions" + Search all parents', /\d+ more parents? match(es)? under other actions/.test(N.el('plMore').innerHTML) && /data-plx="allact"/.test(N.el('plMore').innerHTML), N.el('plMore').innerHTML);
    const before = bodyRows(N.el('plTable').innerHTML);
    N.fire('click', { target: target(['#panePlaudit', '[data-plx]'], { plx: 'allact' }) });
    ok('…clicking it sets Action = All and shows all 10 matches', N.el('plAct').value === 'ALL' && bodyRows(N.el('plTable').innerHTML) === 10 && before < 10);
  }

  console.log('== 3. the cards: the existing plAction names grouped; counts, a click filters, again = all; top 3 by money ==');
  {
    const N = NOW();
    N.renderPlaudit();
    const every = N.PLX.info.every;
    const cnt = acts => every.filter(r => acts.includes(r.action)).length;
    const m = N.PLX.model;
    ok('every action plAction gives is in exactly one card (no new rule, nothing left out)', every.every(r => N.PLX_CARDS.filter(c => c.acts.includes(r.action)).length === 1));
    ok('the counts: 📦 Restock 7 · 👀 Low traffic 4 · 💸 Ad spend high 3 · 📉 Sales down 2 · ✅ Healthy 24', JSON.stringify(m.cards.map(c => c.n)) === JSON.stringify([7, 4, 3, 2, 24]), JSON.stringify(m.cards.map(c => [c.k, c.n])));
    ok('…each = the rows with its actions', m.cards.every(c => c.n === cnt(c.acts)));
    const cards = N.el('plxCards').innerHTML;
    ok('the cards are drawn with their names, counts and the actions they cover', /📦 Restock<\/span><b>7<\/b>/.test(cards) && /Restock — out · Restock — low/.test(cards) && /✅ Healthy<\/span><b>24<\/b>/.test(cards), cards.slice(0, 400));
    const stock = m.cards[0];
    const want = every.filter(r => stock.acts.includes(r.action)).sort((a, b) => (b.avgSales || 0) - (a.avgSales || 0)).slice(0, 3).map(r => r.title);
    ok('📦 lists its top 3 parents by money at stake (a week of average sales)', JSON.stringify(stock.top3.map(x => x.title)) === JSON.stringify(want), JSON.stringify(stock.top3));
    ok('💸 lists its top 3 by last week\'s ad spend', m.cards[2].top3.every((x, i, a) => !i || a[i - 1].stake >= x.stake) && m.cards[2].top3[0].stake === 60);
    N.fire('click', { target: target(['#panePlaudit', '[data-plx-card]'], { plxCard: 'ok' }) });
    let rows = N.R().rows;
    ok('click ✅ Healthy → the table shows all 24 (not only 15, past the "Needs attention" filter)', rows.length === 24 && bodyRows(N.el('plTable').innerHTML) === 24 && rows.every(r => ['Steady', 'New — watch', 'Add budget'].includes(r.action)));
    ok('…the card is marked on, a line says what is shown', /is-ok is-on/.test(N.el('plxCards').innerHTML) && /Showing the ✅ Healthy parents/.test(N.el('plMore').innerHTML));
    ok('…the TOTAL row is over the 24 shown (as any filter)', N.R().total.n === 24 && /24 parents/.test(N.el('plTable').innerHTML));
    N.fire('click', { target: target(['#panePlaudit', '[data-plx-card]'], { plxCard: 'stock' }) });
    rows = N.R().rows;
    ok('click 📦 → only its 7 (Restock — out / low)', rows.length === 7 && rows.every(r => /^Restock/.test(r.action)));
    N.fire('click', { target: target(['#panePlaudit', '[data-plx-card]'], { plxCard: 'stock' }) });
    ok('click it again → the filter is cleared (back to the Action filter: 17 need attention)', N.PLX.card === '' && N.R().rows.length === 17);
    N.fire('click', { target: target(['#panePlaudit', '[data-plx-card]'], { plxCard: 'spend' }) });
    N.el('plAct').value = 'ALL';
    N.el('plAct')._on.input.forEach(fn => fn());
    ok('choosing an Action clears the card', N.PLX.card === '' && N.R().rows.length === 40);
  }

  console.log('== 4. the story and the KPIs match the rows ==');
  {
    const N = NOW();
    N.renderPlaudit();
    const every = N.PLX.info.every, story = N.el('plxStory').textContent;
    ok('the story: "Last week (Nov 15–21) 7 parents need stock, 4 lost traffic, 3 spend too much on ads, 2 are selling down…; 24 are healthy."', /^Last week \(Nov 15–21\) 7 parents need stock, 4 lost traffic, 3 spend too much on ads, 2 are selling down with too much stock; 24 are healthy\./.test(story), story);
    const worry = every.filter(r => !['Steady', 'New — watch', 'Add budget'].includes(r.action)).sort((a, b) => {
      const st = r => (/^Restock/.test(r.action) ? r.avgSales : ['Cut spend', 'Spend too high'].includes(r.action) ? r.lwSpend : Math.max(0, r.avgSales - r.lwSales));
      return st(b) - st(a);
    })[0];
    const days = worry.stock === 0 ? 0 : Math.round(worry.dos * 30.4);
    ok(`"Biggest worry: ${worry.title} (…% vs 6-week average, ${days} days of stock)" — the problem with the most money at stake`, story.includes(`Biggest worry: ${worry.title} (`) && story.includes(`${days} day`), story);
    const sum = k => every.reduce((t, r) => t + (r[k] || 0), 0);
    const kp = N.el('plxKpis').innerHTML;
    const money = v => '$' + Math.round(v).toLocaleString('en-US');
    ok(`Sales last week = the rows' sum (${money(sum('lwSales'))}) vs their 6-week average (${money(sum('avgSales'))}), with ▲/▼ %`, kp.includes(money(sum('lwSales'))) && kp.includes('vs 6-week avg ' + money(sum('avgSales'))) && /[▲▼] \d+%/.test(kp), strip(kp));
    let lsp = 0, asp = 0;
    Object.values(N.PLX.info.weekly).forEach(byW => { if (byW[LAST] && byW[LAST].spend != null) lsp += byW[LAST].spend; N.PLX.info.avgWeeks.forEach(w => { if (byW[w] && byW[w].spend != null) asp += byW[w].spend; }); });
    ok(`Ad spend last week = the weekly store's (${money(lsp)}) vs its 6-week average (${money(asp / 6)})`, kp.includes(money(lsp)) && kp.includes('vs 6-week avg ' + money(asp / 6)), strip(kp));
    const low = every.filter(r => { const d = r.stock === 0 ? 0 : r.dos == null ? null : r.dos * 30.4; return d != null && d < 30 && (r.lwUnits > 0 || r.stock === 0 && r.lwSales > 0); }).length;
    ok(`Under 30 days of stock: ${low} parents (the 4 out + the 3 low)`, low === 7 && N.PLX.model.kpi.low === 7 && /Under 30 days of stock<\/span><b>7<\/b>/.test(kp));
    ok('Ranking worse: 10 parents (BSR snapshots, week on week — the rule of bsrMove)', N.PLX.model.kpi.worse === 10 && /Ranking worse<\/span><b>10<\/b>/.test(kp));
    N.el('plBrand').value = 'CPC';
    N.renderPlaudit();
    ok('brand CPC: the story and the cards follow (10 parents)', N.PLX.model.kpi.n === 10 && N.PLX.model.cards.reduce((t, c) => t + c.n, 0) === 10);
    N.el('plFilter').value = 'p03';
    N.renderPlaudit();
    ok('a search does not change the story or the cards (they are the brand\'s week)', N.PLX.model.kpi.n === 10);
  }

  console.log('== 5. the 📅 week picker ==');
  {
    const N = NOW();
    N.renderPlaudit();
    const sel = N.el('plWeek').innerHTML;
    ok('the weeks with data, newest first, the latest marked and chosen', (sel.match(/<option/g) || []).length === 10 && /^<option value="" selected>Nov 15–21 \(latest\)<\/option><option value="2026-11-08">/.test(sel), sel.slice(0, 200));
    const pick = WEEKS[6];
    N.fire('change', { target: { id: 'plWeek', value: pick } });
    ok(`choosing ${wLabel(pick)} → the table is that week ("${wLabel(pick)}" in the week line)`, N.el('plMsg').textContent.startsWith(wLabel(pick)) && N.PLX.info.lastWeek === pick && N.PLX.info.avgWeeks.join() === WEEKS.slice(1, 7).join());
    if (OLD) {
      // the old page with the clock on the week after → the same table
      const O = load(OLD, { today: sdShift(pick, 8) }), M = NOW();
      for (const X of [O, M]) { X.el('plAct').value = 'ALL'; }
      M.PLX.all = true; M.PLX.week = pick;
      O.renderPlaudit(); M.renderPlaudit();
      // (the listing age is counted to TODAY on both, so the old page — its clock moved — says fewer "days ago"; that text is set aside)
      const noAge = h => h.replace(/\d+ days ago/g, 'N days ago').replace(/Live \d+ days/g, 'Live N days');
      ok('…identical to the old page on that week (every cell and the TOTAL row)', noAge(O.el('plTable').innerHTML) === noAge(noRowAttr(M.el('plTable').innerHTML)));
      O.el('plExport').onclick(); M.el('plExport').onclick();
      ok('…and its Export', O.blobs[0] === M.blobs[0]);
    }
    ok('the story names the chosen week', N.el('plxStory').textContent.startsWith(`Last week (${wLabel(pick)})`));
    N.fire('change', { target: { id: 'plWeek', value: '' } });
    ok('back to the latest', N.PLX.info.lastWeek === LAST);
  }

  console.log('== 6. the side panel: a row click opens it; ✕, Esc and an outside click close it ==');
  {
    const N = NOW();
    N.el('plAct').value = 'ALL';
    N.renderPlaudit();
    const key = 'SP|P005';
    N.el('plTable')._on.click.forEach(fn => fn({ target: { closest: s => (s === 'tr[data-pl-row]' ? { dataset: { plRow: key } } : null) } }));
    await flush();
    const p = N.el('plxPanel');
    ok('a row click opens the panel (not the old card)', !p.hidden && N.PLX.panel === key && N.els.plCardModal.classList.contains('hide'));
    ok('…with the ✕ in its sticky header (aria-label "Close (Esc)")', /<header class="plx-ph">[\s\S]*<button type="button" class="plx-x" data-plx="close" aria-label="Close \(Esc\)">✕<\/button><\/header>/.test(p.innerHTML));
    ok('…the name, the action in one line, + Task (Action Tracker, from Parent Listing Review)', /<h2>Name P005<\/h2>/.test(p.innerHTML) && /Restock — low/.test(p.innerHTML) && /\+ Task/.test(p.innerHTML) && N.tasks.some(o => o.src === 'plr' && o.key === key && o.pick === 'stock'));
    ok('…stock + days of cover', /<b>60<\/b> at Amazon · about \d+ days of cover at last week's rate/.test(p.innerHTML), strip(p.innerHTML).slice(0, 400));
    ok('…the rank as Amazon writes it, with its move: "#3,105 in Tablecloths ▼" (and the main rank)', /<b>#3,105<\/b> in Tablecloths <span class="plx-d is-down"/.test(p.innerHTML) && /#20,500 in Home &amp; Kitchen/.test(p.innerHTML));
    ok('…the children: 2 rows with sales, stock, ad spend', (p.innerHTML.match(/<tr><td><span class="plx-fn">/g) || []).length === 2 && /Red · 60x84/.test(p.innerHTML));
    ok('…links to Listing Health, BSR Audit, Sales Alerts', /data-plx-go="health"/.test(p.innerHTML) && /data-plx-go="bsr"/.test(p.innerHTML) && /data-plx-go="salert"/.test(p.innerHTML));
    const ch = N.charts[N.charts.length - 1];
    ok('the 6-week chart: sales bars + an ad spend line over the 6 weeks, last week highlighted', ch && ch.series[0].type === 'bar' && ch.series[1].type === 'line' && ch.xAxis.data.length === 6
      && ch.series[0].data[5].itemStyle.opacity === 1 && ch.series[0].data[0].itemStyle.opacity < 1 && ch.xAxis.data[5] === wLabel(LAST));
    N.fire('click', { target: target(['#panePlaudit', '#plxPanel', '[data-plx]'], { plx: 'close' }) });
    ok('✕ closes it', p.hidden && N.PLX.panel === '');
    N.plxPanelOpen(key);
    N.fire('keydown', { key: 'Escape' });
    ok('Esc closes it', p.hidden);
    N.plxPanelOpen(key);
    N.fire('click', { target: target(['#panePlaudit']) });
    ok('a click outside closes it', p.hidden);
    N.plxPanelOpen(key);
    N.fire('click', { target: target(['#tkF, .tk-dlg, [data-tk-new], #plCardModal', '#tkF']) });
    ok('…but not a click in the task form', !p.hidden);
    N.fire('click', { target: target(['#panePlaudit', '#plxPanel', '[data-plx]'], { plx: 'card' }) });
    ok('"All figures" opens the existing parent card', !N.els.plCardModal.classList.contains('hide'));
    N.fire('keydown', { key: 'Escape' });
    ok('Esc with the card open leaves the panel open (the card closes first)', !p.hidden);
    N.fire('click', { target: target(['#panePlaudit', '#plxPanel', '[data-plx-go]'], { plxGo: 'salert' }) });
    ok('Sales Alerts link: the brand is set and the tab opens', N.ctx.AL.brand === 'SP' && N.ctx._tab === 'salert');
  }

  console.log('== 7. ✨ off: no animation, everything still drawn; no ECharts → a plain bar list ==');
  {
    const N = NOW({ fx: false });
    N.el('plAct').value = 'ALL';
    N.renderPlaudit();
    N.plxPanelOpen('SP|P020');
    await flush();
    ok('✨ off → the chart has animation: false; the story, KPIs and cards are drawn', N.plxFx() === false && N.charts[0].animation === false && N.el('plxStory').textContent.length > 40 && /plx-card/.test(N.el('plxCards').innerHTML));
    const M = NOW();
    M.ctx.window.echarts = null;
    M.renderPlaudit();
    M.plxPanelOpen('SP|P020');
    await flush();
    ok('no ECharts → the panel draws a plain list of the 6 weeks', (M.el('plxChart').innerHTML.match(/<li/g) || []).length === 6 && /is-last/.test(M.el('plxChart').innerHTML));
    const S = NOW();
    S.el('plxPanel'); S.els.plIns = S.el('plIns');
    await S.ensurePlaudit();
    ok('the skeletons are drawn first, then replaced by the figures', /plx-kpis/.test(S.el('plIns').innerHTML) && S.el('plxStory').textContent.startsWith('Last week'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
