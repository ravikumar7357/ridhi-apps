/* Sales Analysis (src/app/sales/sales-analysis.js) + its insights (sales-analysis-insights.js, 28 Nov 2026) in a stub page.
 *   node tests/sales-analysis-test.js
 * The table — every view and metric — is the SAME as before this change (a7f61e07): every cell, value and heat-map colour; Export the
 * same file (all rows). The top 15 + "Show other N", Show fewer, search over all rows, the story / cards / charts following brand, view
 * and metric, a card or a bar showing rows outside the top 15. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 600) : '')); } };
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', f), 'utf8');
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* ---- the fixture: 30 months newest first (Nov '26 … Jun '24), built 20 Nov 2026 (Nov still running → the latest COMPLETE month is Oct) ---- */
const MONTHS = [];
for (let i = 0; i < 30; i++) { const d = new Date(Date.UTC(2026, 10 - i, 1)); MONTHS.push(d.toISOString().slice(0, 7)); }
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABELS = MONTHS.map(m => `${MON[+m.slice(5, 7)]} '${m.slice(2, 4)}`);
let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function build(names, special, price) {
  const rows = names.map((name, k) => {
    const base = Math.max(3, Math.round(200 / (k + 1)));
    const q = MONTHS.map((m, i) => {
      const mo = +m.slice(5, 7);
      let u = Math.round(base * (0.8 + rnd() * 0.4));
      const s = special[name];
      if (s === 'rise') u = i <= 3 ? 220 + i * 5 : i >= 12 ? 25 : 60;                     // the last months up, a year ago low
      if (s === 'fall') u = i <= 3 ? 40 : i >= 12 && i <= 16 ? 260 : 150;
      if (s === 'season') u = mo === 11 || mo === 12 ? 300 : 20;
      if (s === 'top') u = 600 + Math.round(rnd() * 40);
      return u;
    });
    return { name, skus: 1 + (k % 5), q };
  });
  const total = MONTHS.map((m, i) => rows.reduce((t, r) => t + r.q[i], 0));
  return rows.map(r => ({ name: r.name, skus: r.skus, m: r.q.map((u, i) => ({ qty: u, amt: Math.round(u * price), pct: total[i] ? u / total[i] : 0 })), _r: r.q[0] * price + r.q[1] * price }))
    .sort((a, b) => b._r - a._r).map(r => { delete r._r; return r; });
}
const COLORS = ['Asparagus Green', 'Oak Brown', 'Light Steel Blue', 'Christmas Red'].concat(Array.from({ length: 36 }, (x, i) => `Colour ${String(i + 1).padStart(2, '0')}`));
function dataFor(brand) {
  seed = brand === 'CPC' ? 77 : 5;
  const color = build(brand === 'CPC' ? COLORS.slice(4) : COLORS, brand === 'CPC' ? { 'Colour 05': 'top' } : { 'Asparagus Green': 'top', 'Oak Brown': 'rise', 'Light Steel Blue': 'fall', 'Christmas Red': 'season' }, 20);
  const article = build(['Tablecloths', 'Napkins', 'Table Runners', 'Placemats', 'Pillow Covers', 'Aprons', 'Quilts', 'Coasters'], { Tablecloths: 'top' }, 30);
  const sku = build(Array.from({ length: 60 }, (x, i) => `RT-${100 + i}`), {}, 25).map((r, i) => Object.assign(r, { subcat: ['Tablecloths', 'Napkins'][i % 2], color: COLORS[i % 10], size: ['60x90', '18x18'][i % 2] }));
  return { months: MONTHS, labels: LABELS, at: '2026-11-20 10:00', color, article, sku, skuChunks: 2 };
}

function load(srcText, opts) {
  opts = opts || {};
  const els = {};
  const cl = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  const el = id => els[id] || (els[id] = { id, value: { saBrand: 'SP', saView: 'color', saMetric: 'pct' }[id] || '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: cl(),
    addEventListener(t, fn) { (this._on = this._on || {})[t] = fn; }, querySelectorAll: () => [], querySelector: () => null, isConnected: true });
  const blobs = [];
  const docs = { 'salesanalysis/SP': dataFor('SP'), 'salesanalysis/CPC': dataFor('CPC') };
  // the SKU rows live in their own chunks (sarows/<brand>_<n>), as the real save writes them
  ['SP', 'CPC'].forEach(b => { const rows = docs['salesanalysis/' + b].sku; docs['sarows/' + b + '_0'] = { r: rows.slice(0, 30) }; docs['sarows/' + b + '_1'] = { r: rows.slice(30) }; delete docs['salesanalysis/' + b].sku; });
  const ctx = {
    $: el, document: { getElementById: el, addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) }, window: undefined,
    db: {}, doc: (d, c, id) => ({ path: c + '/' + id }), getDoc: async ref => ({ exists: () => ref.path in docs, data: () => JSON.parse(JSON.stringify(docs[ref.path])) }), setDoc: async () => {},
    serverTimestamp: () => 0, baCall: async () => ({ ok: false }), ME: { email: 'x' }, dToday: () => '2026-11-28', Blob: class { constructor(parts) { blobs.push(parts.join('')); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  const tail = '\n;return { SA: () => SA, renderSa, ensureSa, loadSaCache' + (opts.sai ? ', SAI, saiModel, saiRender, saiReveal, saiToggleTrend, saiLimit' : '') + ' };';
  const api = new Function(...Object.keys(ctx), srcText + tail)(...Object.values(ctx));
  return Object.assign(api, { el, els, blobs, docs });
}
const NOW = () => load(SRC('sales-analysis.js') + '\n;' + SRC('sales-analysis-insights.js'), { sai: true });
let OLD = null;
try { OLD = cp.execSync('git show a7f61e07:Pricing-App/src/app/sales/sales-analysis.js', { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { OLD = null; }
const noRowAttr = h => String(h).replace(/<tr data-sa-row="[^"]*">/g, '<tr>');
const rowsOf = h => (String(h).match(/<tr[ >]/g) || []).length - 1;              // minus the head row

(async () => {
  console.log('== 1. the table is the same as before, every view and metric (cells, values, heat-map colours); Export the same ==');
  if (!OLD) ok('(the file before this change, a7f61e07, is not in this checkout — skipped)', true);
  else {
    for (const view of ['color', 'article', 'sku']) {
      for (const metric of ['pct', 'qty', 'amt']) {
        const O = load(OLD), N = NOW();
        for (const X of [O, N]) { await X.loadSaCache(); X.el('saView').value = view; X.el('saMetric').value = metric; X.SA().view = view; X.SA().metric = metric; }
        O.renderSa();
        N.renderSa(); N.SAI.all = true; N.renderSa();                    // the first draw of a view starts on the top 15; then Show other
        const same = noRowAttr(N.el('saTable').innerHTML) === O.el('saTable').innerHTML;
        const A1 = O.el('saTable').innerHTML, B1 = noRowAttr(N.el('saTable').innerHTML); let di = 0; while (di < A1.length && A1[di] === B1[di]) di++;
        ok(`${view} · ${metric}: every row and cell the same (all rows shown)`, same, same ? '' : 'at ' + di + ': OLD …' + A1.slice(di - 80, di + 120) + ' ||| NEW …' + B1.slice(di - 80, di + 120));
        N.SAI.all = false; N.renderSa();
        const oldRows = O.el('saTable').innerHTML.split('</tr>');
        const firstN = noRowAttr(N.el('saTable').innerHTML);
        const n = Math.min(15, rowsOf(O.el('saTable').innerHTML));
        ok(`${view} · ${metric}: by default the first ${n} rows, exactly as before`, firstN === oldRows.slice(0, n + 1).join('</tr>') + '</tr></tbody>' && rowsOf(firstN) === n, firstN.slice(-200));
        O.el('saExport').onclick(); N.el('saExport').onclick();
        ok(`${view} · ${metric}: Export the same file (every row)`, O.blobs[0] === N.blobs[0] && O.blobs[0].split('\r\n').length - 1 === (N.SA().data[view] || []).length, O.blobs[0].slice(0, 120));
      }
    }
  }

  console.log('== 2. the top 15, "Show other N colours", Show fewer, search over all rows ==');
  const N = NOW();
  await N.ensureSa();
  ok('top 15 by default (the table\'s own order) and "Show other 25 colours ▾"', rowsOf(N.el('saTable').innerHTML) === 15 && /Show other 25 colours ▾/.test(N.el('saMore').innerHTML), N.el('saMore').innerHTML);
  N.SAI.all = true; N.renderSa();
  ok('"Show other …" → all 40, then "Show fewer ▴"', rowsOf(N.el('saTable').innerHTML) === 40 && /Show fewer ▴/.test(N.el('saMore').innerHTML));
  N.SAI.all = false; N.renderSa();
  ok('"Show fewer" → the top 15 again', rowsOf(N.el('saTable').innerHTML) === 15);
  N.el('saView').value = 'article'; N.SA().view = 'article'; N.renderSa();
  ok('the word follows the view: 8 articles → no button (all fit)', N.el('saMore').innerHTML === '' && rowsOf(N.el('saTable').innerHTML) === 8);
  N.SA().view = 'sku'; N.el('saView').value = 'sku'; N.renderSa();
  ok('…SKUs: "Show other 45 SKUs ▾"', /Show other 45 SKUs ▾/.test(N.el('saMore').innerHTML));
  N.SA().view = 'color'; N.el('saView').value = 'color'; N.renderSa();
  const late = N.SA().data.color[30].name;
  N.el('saFilter').value = late.toLowerCase(); N.renderSa();
  ok(`search looks through ALL rows: "${late}" (row 31) found`, rowsOf(N.el('saTable').innerHTML) >= 1 && N.el('saTable').innerHTML.includes(`data-sa-row="${late}"`) && N.el('saMore').innerHTML === '');
  N.el('saFilter').value = ''; N.renderSa();

  console.log('== 3. the story, the cards, the charts — for the brand / view / metric picked ==');
  const m = N.SAI.model;
  ok('the latest COMPLETE month: Oct (the data was built on 20 Nov — Nov is still running)', m.L === 1 && m.month === 'Oct');
  ok('the story: "Top colour: Asparagus Green (…% of units in Oct). Rising: Oak Brown (… → … vs last year). Falling: Light Steel Blue (…)."', /^Top colour: Asparagus Green \(\d+\.\d% of units in Oct\)\. Rising: Oak Brown \(\d+\.\d% → \d+\.\d% vs last year\)\. Falling: Light Steel Blue \(\d+\.\d% → \d+\.\d% vs last year\)\.$/.test(m.story), m.story);
  ok('the cards: 🔥 Rising led by Oak Brown, 📉 Falling by Light Steel Blue, 🎄 Seasonal: Christmas Red "best in Nov–Dec"', m.rise[0].name === 'Oak Brown' && m.fall[0].name === 'Light Steel Blue' && m.season.some(x => x.name === 'Christmas Red' && x.label === 'best in Nov–Dec'), JSON.stringify([m.rise.map(x => x.name), m.fall.map(x => x.name), m.season]));
  const ins = N.el('saIns').innerHTML;
  ok('drawn above the table: the story, two charts (top 10 · last 12 months), three cards with their top 5 and change ("+… pts")', /class="sai-story"/.test(ins) && /Top 10 colours · Oct · % share of units/.test(ins) && /Last 12 months · % share of units · last year dotted/.test(ins)
    && /data-sai-card="rise"/.test(ins) && /data-sai-card="fall"/.test(ins) && /data-sai-card="season"/.test(ins) && /<b>\+\d+\.\d pts<\/b>/.test(ins), strip(ins).slice(0, 600));
  await new Promise(r => setImmediate(r));
  ok('no chart library here: the top 10 as a plain list of 10 bars (the safety net); the trend says it could not be drawn', (N.el('saiBars').innerHTML.match(/data-sai-bar=/g) || []).length === 10 && /could not be drawn/.test(N.el('saiTrend').innerHTML), N.el('saiBars').innerHTML.slice(0, 200));
  N.SA().metric = 'qty'; N.el('saMetric').value = 'qty'; N.renderSa();
  ok('metric "Units": the story in units ("… units in Oct"), cards in units', /^Top colour: Asparagus Green \([\d,]+ units in Oct\)/.test(N.SAI.model.story) && /units<\/b>/.test(N.el('saIns').innerHTML), N.SAI.model.story);
  N.SA().metric = 'amt'; N.el('saMetric').value = 'amt'; N.renderSa();
  ok('metric "Sales $": "$…"', /^Top colour: Asparagus Green \(\$[\d,]+ in Oct\)/.test(N.SAI.model.story), N.SAI.model.story);
  N.SA().view = 'article'; N.el('saView').value = 'article'; N.renderSa();
  ok('view "Article study": "Top article: Tablecloths …"', /^Top article: Tablecloths/.test(N.SAI.model.story), N.SAI.model.story);
  N.SA().view = 'color'; N.el('saView').value = 'color'; N.SA().metric = 'pct'; N.el('saMetric').value = 'pct';
  N.SA().brand = 'CPC'; N.SA().data = null; await N.loadSaCache(); N.renderSa();
  ok('brand CPC: its own story (Top colour: Colour 05 …)', /^Top colour: Colour 05/.test(N.SAI.model.story), N.SAI.model.story);
  N.SA().brand = 'SP'; N.SA().data = null; await N.loadSaCache(); N.renderSa();

  console.log('== 4. a card or a bar shows rows outside the top 15 ==');
  const rows = N.SA().data.color;
  const rising = N.SAI.model.rise.map(x => x.name);
  const outside = rising.filter(nm => rows.findIndex(r => r.name === nm) >= 15);
  N.SAI.only = 'rise'; N.renderSa();
  ok('🔥 Rising card: the table shows exactly its rows — also those outside the top 15', rising.every(nm => N.el('saTable').innerHTML.includes(`data-sa-row="${nm}"`)) && rowsOf(N.el('saTable').innerHTML) === rising.length && /Showing the \d+ 🔥 Rising colours/.test(N.el('saMore').innerHTML), JSON.stringify([rising, outside]));
  N.SAI.only = ''; N.renderSa();
  ok('…again (Show all): the top 15', rowsOf(N.el('saTable').innerHTML) === 15);
  const hidden = rows[33].name;
  N.saiReveal(hidden);
  ok(`a bar click on "${hidden}" (row 34): shown in the table (16 rows), highlighted`, N.el('saTable').innerHTML.includes(`data-sa-row="${hidden}"`) && rowsOf(N.el('saTable').innerHTML) === 16 && /Show other 24 colours/.test(N.el('saMore').innerHTML));
  ok('the trend: the top 3 by default; a table row click adds one (up to 5, the oldest goes)', N.SAI.trend.length === 3 && (N.saiToggleTrend('Colour 20'), N.saiToggleTrend('Colour 21'), N.saiToggleTrend('Colour 22'), N.SAI.trend.length === 5 && !N.SAI.trend.includes(N.SAI.model.trendDef[0]) && N.SAI.trend.includes('Colour 22')));
  N.saiToggleTrend('Colour 22');
  ok('…and a second click removes it', !N.SAI.trend.includes('Colour 22'));

  console.log('== 5. read-only; the page unchanged ==');
  const ins2 = SRC('sales-analysis-insights.js');
  ok('the insights read only SA.data: no backend, Amazon or database call', !/\b(baCall|getDoc|setDoc|fetch|imPost)\(/.test(ins2));
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  ok('the toolbar unchanged (brand, view, metric, search, Rebuild from orders, Export); the insights above the table, "Show other" under it', /<select id="saBrand"[\s\S]*<select id="saView"[\s\S]*<select id="saMetric"[\s\S]*<input id="saFilter"[\s\S]*<button id="saRebuild"[\s\S]*<button id="saExport"/.test(html)
    && /<section id="saIns" class="sai"[^>]*><\/section>\r?\n\s*<div class="card xlwrap mt-12">\r?\n\s*<table id="saTable" class="xl"><\/table>\r?\n\s*<\/div>\r?\n\s*<div id="saMore"/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
