/* ================= SALES · SALES ANALYSIS — INSIGHTS ABOVE THE TABLE (28 Nov 2026) =================
 * Screen: Sales → Analyse → Sales Analysis. The existing page (sales/sales-analysis.js: the toolbar, the month-by-month heat-map table,
 *   its colours, columns and maths, Export) is unchanged. Added ABOVE the table, following the brand / view / metric pickers:
 *   · a STORY LINE from the numbers ("Top colour: Asparagus Green (14.2% of units in Oct). Rising: … Falling: …");
 *   · two CHARTS side by side (a phone stacks them): the top 10 rows of the latest complete month (a bar click = that row highlighted
 *     and scrolled to, shown even when it is not in the top 15) and the last 12 months of up to 5 rows (default the top 3; a click on a
 *     table row adds / removes it), last year dotted;
 *   · three INSIGHT CARDS (a click filters the table to their rows, again = all): 🔥 Rising (the biggest gain, the last 3 complete months
 *     against the same 3 months a year before, at least 30 units), 📉 Falling (the biggest drop, the same rule), 🎄 Seasonal (always on
 *     UNITS: in the latest full year a month — or two neighbouring months — sells ≥ 1.5 × the row's own monthly average, ≥ 30 units that
 *     year; a 2nd year, when there is one, peaks in the same or a neighbouring month — "best in Nov–Dec · ×2.3 normal", strongest first,
 *     and "Peaking now 🎄" for those whose peak is this month or next).
 *   A catalogue-less group, "(unknown)", is shown as "No colour in catalog (N SKUs)" with its SKUs in the tooltip, so they can be fixed.
 *   And the table shows the TOP 15 rows (its own order) by default, with "Show other N colours ▾" / "Show fewer ▴" under it; a search,
 *   an insight card or a bar shows rows outside the top 15. Export still writes every row.
 * THE LATEST MONTH = the newest COMPLETE month: the month the data was built in is still running, so it is left out (it would make
 *   units and money look low). Units / % share / money follow the metric picked; volume rules always count units.
 * READ-ONLY: only SA.data (the saved matrix). ECharts (the Sales Dashboard's loader, sdcLoadCharts) draws the charts; without it a plain
 *   bar list is shown. ✨ off or reduced motion: no animation.
 * Main functions: saiModel (pure), saiRender, saiLimit, saiAfterTable, saiReveal, saiShell. Names sai / SAI. Tests: tests/sales-analysis-test.js. */

// season (28 Nov 2026): a month — or two neighbouring months — at ≥ 1.5 × the row's own monthly average, in UNITS, ≥ 30 units a year
const SAI_M = { top: 15, bars: 10, trendMax: 5, trendDef: 3, minUnits: 30, seasonPeak: 1.5, seasonUnits: 30 };
const SAI = { key: '', model: null, all: false, only: '', reveal: new Set(), trend: null, charts: {}, flash: '' };
const SAI_WORD = { color: ['colour', 'colours'], article: ['article', 'articles'], sku: ['SKU', 'SKUs'] };
const SAI_COLORS = ['#0071e3', '#e8590c', '#2f9e44', '#ae3ec9', '#c2255c'];
const saiEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const SAI_NUM = new Intl.NumberFormat('en-US');
const saiMonNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const saiEl = id => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);

/* ----- the numbers (pure) ----- */
/** A row's name as shown: the catalogue-less group "(unknown)" of the colour / article view → "No colour in catalog (12 SKUs)". */
function saiLabel(row, view) {
  if (!row || row.name !== '(unknown)' || (view !== 'color' && view !== 'article')) return row ? row.name : '';
  return `No ${view === 'color' ? 'colour' : 'article'} in catalog (${row.skus || 0} SKU${row.skus === 1 ? '' : 's'})`;
}
/** The SKUs behind "(unknown)": the SKU view's rows with no colour (or no article) in the catalogue — for the tooltip. */
function saiUnknownSkus(data, view) {
  const key = view === 'color' ? 'color' : 'subcat';
  return ((data && data.sku) || []).filter(r => !String(r[key] || '').trim()).map(r => r.name);
}
// The month of a date / today (US Pacific): 1–12.
const saiMonthOf = now => +(String(now || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())).slice(5, 7));
/** A cell's value for a metric (as the table shows it). */
const saiVal = (cell, metric) => (!cell ? 0 : metric === 'amt' ? cell.amt || 0 : metric === 'pct' ? cell.pct || 0 : cell.qty || 0);
/** A value as text: "14.2%", "1,234 units", "$12,345". */
const saiFmt = (v, metric, bare) => (metric === 'pct' ? (v * 100).toFixed(1) + '%' : metric === 'amt' ? '$' + SAI_NUM.format(Math.round(v)) : SAI_NUM.format(Math.round(v)) + (bare ? '' : ' units'));
const saiChange = (d, metric) => (metric === 'pct' ? `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts` : metric === 'amt' ? `${d >= 0 ? '+' : '−'}$${SAI_NUM.format(Math.round(Math.abs(d)))}` : `${d >= 0 ? '+' : '−'}${SAI_NUM.format(Math.round(Math.abs(d)))} units`);
/** The model of a view: { L (index of the latest complete month), month (its label), top10, rise, fall, season, story, trendDef, cmp }.
 *  data = SA.data ({ months newest first, labels, at, color, article, sku }). */
function saiModel(data, view, metric, now) {
  const rows = (data && data[view]) || [];
  const months = (data && data.months) || [];
  const built = String((data && data.at) || '').slice(0, 7);
  const L = months[0] && months[0] === built ? 1 : 0;                       // the newest COMPLETE month
  const out = { L, month: '', monthKey: months[L] || '', top10: [], rise: [], fall: [], season: [], peakNow: [], story: '', trendDef: [], cmp: 'ly', n: rows.length };
  const lab = name => saiLabel(rows.find(r => r.name === name), view);
  if (!rows.length || L >= months.length) { out.story = rows.length ? 'Not enough months yet.' : ''; return out; }
  out.month = saiMonNames[+months[L].slice(5, 7)];
  const v = (row, i) => saiVal((row.m || [])[i], metric);
  const q = (row, i) => (((row.m || [])[i] || {}).qty || 0);
  // the top 10 of the latest complete month
  out.top10 = rows.map(row => ({ name: row.name, label: saiLabel(row, view), v: v(row, L) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, SAI_M.bars);
  out.trendDef = out.top10.slice(0, SAI_M.trendDef).map(x => x.name);
  // rising / falling: the last 3 complete months against the same 3 months a year before (else the 3 months before, and it says so)
  const ly = months.length >= L + 15;
  out.cmp = ly ? 'ly' : months.length >= L + 6 ? 'prev' : '';
  if (out.cmp) {
    const off = ly ? 12 : 3;
    const agg = (row, from) => { let s = 0; for (let i = from; i < from + 3; i++) s += v(row, i); return metric === 'pct' ? s / 3 : s; };
    const units = (row, from) => { let s = 0; for (let i = from; i < from + 3; i++) s += q(row, i); return s; };
    const ch = rows.filter(row => units(row, L) >= SAI_M.minUnits || units(row, L + off) >= SAI_M.minUnits)
      .map(row => ({ name: row.name, label: saiLabel(row, view), now: agg(row, L), was: agg(row, L + off), d: agg(row, L) - agg(row, L + off) }));
    out.rise = ch.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
    out.fall = ch.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
  }
  // SEASONAL (28 Nov 2026) — always on UNITS, whatever the metric shown: in the latest full year (the 12 complete months) the best month
  // sells ≥ 1.5 × the row's own monthly average (its better neighbour too, when that one is also ≥ 1.5 ×: "Nov–Dec"), with ≥ 30 units
  // that year; a 2nd full year with ≥ 30 units, when there is one, must peak in the same or a neighbouring month. Strength = the peak
  // months' average ÷ the monthly average ("×2.3 normal"), strongest first.
  if (months.length >= L + 12) {
    const moy = i => +months[i].slice(5, 7);
    const near = (a, b) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b)) <= 1;
    const peakOf = (row, from) => {
      const byM = {};
      let tot = 0;
      for (let i = from; i < from + 12; i++) { const u = q(row, i); byM[moy(i)] = u; tot += u; }
      const avg = tot / 12;
      let bm = 1;
      for (let mo = 2; mo <= 12; mo++) if ((byM[mo] || 0) > (byM[bm] || 0)) bm = mo;
      const prev = bm === 1 ? 12 : bm - 1, next = bm === 12 ? 1 : bm + 1;
      const nb = (byM[prev] || 0) >= (byM[next] || 0) ? prev : next;          // the better neighbour
      const two = avg > 0 && (byM[nb] || 0) >= SAI_M.seasonPeak * avg;
      const mos = two ? (nb === prev ? [prev, bm] : [bm, nb]) : [bm];
      const peak = mos.reduce((t, mo) => t + (byM[mo] || 0), 0) / mos.length;
      return { mos, bm, tot, x: avg > 0 ? peak / avg : 0 };
    };
    const nowM = saiMonthOf(now), nextM = nowM === 12 ? 1 : nowM + 1;
    rows.forEach(row => {
      const a = peakOf(row, L);
      if (a.tot < SAI_M.seasonUnits || a.x < SAI_M.seasonPeak) return;
      if (months.length >= L + 24) {                                         // a 2nd full year: the peak lands in the same or a neighbouring month
        const b = peakOf(row, L + 12);
        if (b.tot >= SAI_M.seasonUnits && !near(a.bm, b.bm)) return;
      }
      const when = a.mos.map(mo => saiMonNames[mo]).join('–');
      out.season.push({ name: row.name, label: saiLabel(row, view), mos: a.mos, x: a.x, when, line: `best in ${when} · ×${a.x.toFixed(1)} normal`,
        now: a.mos.includes(nowM) || a.mos.includes(nextM) });
    });
    out.season.sort((x, y) => y.x - x.x);
    out.peakNow = out.season.filter(x => x.now).map(x => x.label);
    out.season = out.season.slice(0, 5);
  }
  // the story
  const word = (SAI_WORD[view] || SAI_WORD.color)[0];
  const t = out.top10[0];
  const parts = [];
  if (t) parts.push(`Top ${word}: ${t.label} (${metric === 'pct' ? saiFmt(t.v, metric) + ' of units' : saiFmt(t.v, metric)} in ${out.month}).`);
  const vs = out.cmp === 'ly' ? 'vs last year' : 'vs the 3 months before';
  const r = out.rise[0], f = out.fall[0];
  if (r) parts.push(`Rising: ${r.label} (${saiFmt(r.was, metric, true)} → ${saiFmt(r.now, metric)} ${vs}).`);
  if (f) parts.push(`Falling: ${f.label} (${saiFmt(f.was, metric, true)} → ${saiFmt(f.now, metric)} ${vs}).`);
  out.story = parts.join(' ') || 'No sales in the latest complete month.';
  return out;
}

/* ----- the table's rows: the top 15, or all ----- */
/** Which rows the table draws: the card's rows (a card on); every match of a search; all (Show other N); else the top 15 + the rows a bar
 *  revealed. → { shown, rest (rows not drawn), word } — the order is the table's own. */
function saiLimit(rows, search) {
  const m = SAI.model;
  if (SAI.only && m) {
    const names = new Set((m[SAI.only] || []).map(x => x.name));
    return { shown: rows.filter(r => names.has(r.name)).slice(0, 400), rest: 0, card: SAI.only };
  }
  if (search || SAI.all) return { shown: rows.slice(0, 400), rest: 0, all: !search && rows.length > SAI_M.top };
  const shown = rows.filter((r, i) => i < SAI_M.top || SAI.reveal.has(r.name));
  return { shown, rest: rows.length - shown.length };
}
/** Under the table: "Show other 220 colours ▾" / "Show fewer ▴" / the card's note. */
function saiAfterTable(lim, view) {
  const el = saiEl('saMore');
  if (!el) return;
  const [one, many] = SAI_WORD[view] || SAI_WORD.color;
  const card = { rise: '🔥 Rising', fall: '📉 Falling', season: '🎄 Seasonal' };
  if (lim.card) el.innerHTML = `<span class="muted">Showing the ${lim.shown.length} ${card[lim.card]} ${lim.shown.length === 1 ? one : many}</span><button type="button" class="ghost sai-btn" data-sai="clear">Show all ✕</button>`;
  else if (lim.rest > 0) el.innerHTML = `<button type="button" class="ghost sai-btn" data-sai="more" aria-expanded="false">Show other ${SAI_NUM.format(lim.rest)} ${lim.rest === 1 ? one : many} ▾</button>`;
  else if (lim.all) el.innerHTML = '<button type="button" class="ghost sai-btn" data-sai="fewer" aria-expanded="true">Show fewer ▴</button>';
  else el.innerHTML = '';
  // the rows picked for the trend chart, and a row a bar revealed, marked
  const t = saiEl('saTable');
  if (t && t.querySelectorAll) {
    const picked = new Set(SAI.trend || []);
    t.querySelectorAll('tr[data-sa-row]').forEach(tr => { tr.classList.toggle('sai-sel', picked.has(tr.dataset.saRow)); });
    if (SAI.flash) {
      const tr = [...t.querySelectorAll('tr[data-sa-row]')].find(x => x.dataset.saRow === SAI.flash);
      SAI.flash = '';
      if (tr) {
        tr.classList.add('sai-flash');
        if (tr.scrollIntoView) tr.scrollIntoView({ block: 'center', behavior: saiFx() ? 'smooth' : 'auto' });
        setTimeout(() => tr.classList.remove('sai-flash'), 2200);
      }
    }
  }
}

/* ----- drawing ----- */
const saiFx = () => {
  let on = typeof sdcFxSaved === 'function' ? sdcFxSaved() : true;
  try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) on = false; } catch (e) { /* as saved */ }
  return on;
};
/** The frame with skeletons, drawn before the saved matrix is read. */
function saiShell() {
  const el = saiEl('saIns');
  if (!el || el.dataset.ready) return;
  el.innerHTML = '<p class="sai-story"><span class="sai-sk sai-sk-line"></span></p><div class="sai-charts"><div class="sai-chart"><i class="sai-sk"></i></div><div class="sai-chart"><i class="sai-sk"></i></div></div>'
    + '<div class="sai-cards"><i class="sai-sk sai-sk-card"></i><i class="sai-sk sai-sk-card"></i><i class="sai-sk sai-sk-card"></i></div>';
}
/** Above the table, for the brand / view / metric picked. Worked out once per (brand, view, metric, build); the cards' state always redrawn. */
function saiRender() {
  const el = saiEl('saIns');
  if (!el) return;
  if (typeof SA === 'undefined' || !SA.data) { el.innerHTML = ''; el.dataset.ready = ''; return; }
  const key = [SA.brand, SA.view, SA.metric, SA.data.at, (SA.data[SA.view] || []).length].join('|');
  const viewKey = SA.brand + '|' + SA.view;
  if (SAI.viewKey !== viewKey) { SAI.viewKey = viewKey; SAI.all = false; SAI.only = ''; SAI.reveal = new Set(); SAI.trend = null; }
  if (SAI.key !== key) {
    SAI.key = key;
    SAI.model = saiModel(SA.data, SA.view, SA.metric);
    if (!SAI.trend) SAI.trend = SAI.model.trendDef.slice();
    el.dataset.ready = '1';
    saiDraw(el);
  } else saiCards(el);
}
function saiCards(el) {
  const box = el.querySelector ? el.querySelector('.sai-cards') : null;
  if (box) box.innerHTML = saiCardsHtml();
}
function saiCardsHtml() {
  const m = SAI.model;
  const vs = m.cmp === 'ly' ? 'last 3 months vs the same months last year' : m.cmp === 'prev' ? 'last 3 months vs the 3 before' : '';
  const others = { color: 'Article or SKU', article: 'Colour or SKU', sku: 'Colour or Article' }[SA.view] || 'another';
  const list = (items, line, none) => (items.length ? `<ol>${items.map(x => `<li><span>${saiEsc(x.label || x.name)}</span><b>${saiEsc(line(x))}</b></li>`).join('')}</ol>` : `<p class="muted">${saiEsc(none || 'None this time.')}</p>`);
  const card = (k, t, sub, items, line, none, extra) => `<button type="button" class="sai-card${SAI.only === k ? ' is-on' : ''}" data-sai-card="${k}" aria-pressed="${SAI.only === k}"${items.length ? '' : ' disabled'}>`
    + `<span class="sai-ct">${t}</span><small class="muted">${saiEsc(sub)}</small>${list(items, line, none)}${extra || ''}</button>`;
  return card('rise', '🔥 Rising', vs || 'not enough months yet', m.rise, x => saiChange(x.d, SA.metric))
    + card('fall', '📉 Falling', vs || 'not enough months yet', m.fall, x => saiChange(x.d, SA.metric))
    + card('season', '🎄 Seasonal', 'on units: a month at ≥ 1.5 × its own monthly average', m.season, x => x.line, `No clear seasonal pattern in this view — try ${others} view.`,
      m.peakNow.length ? `<p class="sai-now">Peaking now 🎄 ${saiEsc(m.peakNow.slice(0, 5).join(', '))}${m.peakNow.length > 5 ? ` +${m.peakNow.length - 5} more` : ''}</p>` : '');
}
function saiDraw(el) {
  const m = SAI.model;
  const [one] = SAI_WORD[SA.view] || SAI_WORD.color;
  const metricWord = SA.metric === 'pct' ? '% share of units' : SA.metric === 'amt' ? 'sales $' : 'units';
  el.innerHTML = `<p class="sai-story">${saiEsc(m.story)}</p>`
    + `<div class="sai-charts"><figure class="sai-chart"><figcaption>Top ${SAI_M.bars} ${saiEsc((SAI_WORD[SA.view] || SAI_WORD.color)[1])} · ${saiEsc(m.month)} · ${saiEsc(metricWord)}</figcaption><div id="saiBars" class="sai-cv" role="img" aria-label="Top ${SAI_M.bars} by ${saiEsc(metricWord)} in ${saiEsc(m.month)}"><i class="sai-sk"></i></div></figure>`
    + `<figure class="sai-chart"><figcaption>Last 12 months · ${saiEsc(metricWord)} · last year dotted <span class="muted">— click a ${saiEsc(one)} in the table to add or remove it (up to ${SAI_M.trendMax})</span></figcaption><div id="saiTrend" class="sai-cv" role="img" aria-label="The last 12 months of the ${saiEsc(one)}s picked"><i class="sai-sk"></i></div></figure></div>`
    + `<div class="sai-cards" role="group" aria-label="Insights — click one to show only its rows">${saiCardsHtml()}</div>`;
  saiCharts();
}
// The months of the trend: the 12 complete months, oldest first (index into SA.data.months), and the same months a year before.
function saiTrendData() {
  const m = SAI.model, data = SA.data;
  const idx = [];
  for (let i = m.L + 11; i >= m.L; i--) if (i < data.months.length) idx.push(i);
  const rows = data[SA.view] || [];
  const series = (SAI.trend || []).map(name => rows.find(r => r.name === name)).filter(Boolean).map((row, k) => ({
    name: saiLabel(row, SA.view), color: SAI_COLORS[k % SAI_COLORS.length], now: idx.map(i => saiVal((row.m || [])[i], SA.metric)),
    ly: idx.map(i => (i + 12 < data.months.length ? saiVal((row.m || [])[i + 12], SA.metric) : null)) }));
  return { labels: idx.map(i => saiMonNames[+data.months[i].slice(5, 7)] + " '" + data.months[i].slice(2, 4)), series };
}
function saiCharts() {
  const m = SAI.model;
  const bars = saiEl('saiBars'), trend = saiEl('saiTrend');
  if (!bars || !trend) return;
  const plain = () => {                                                       // no chart library: a plain list (the safety net)
    const max = Math.max(...m.top10.map(x => x.v), 0) || 1;
    bars.innerHTML = `<ol class="sai-plain">${m.top10.map(x => `<li><button type="button" data-sai-bar="${saiEsc(x.name)}"><span>${saiEsc(x.label || x.name)}</span><i style="width:${Math.round(x.v / max * 100)}%"></i><b>${saiEsc(saiFmt(x.v, SA.metric, true))}</b></button></li>`).join('')}</ol>`;
    trend.innerHTML = '<p class="muted sai-nochart">The trend chart could not be drawn (the chart library did not load).</p>';
  };
  const load = typeof sdcLoadCharts === 'function' ? sdcLoadCharts() : Promise.resolve(!!(typeof window !== 'undefined' && window.echarts));
  Promise.resolve(load).then(ok => {
    if (!ok || typeof window === 'undefined' || !window.echarts || !bars.isConnected) { if (bars.isConnected !== false) plain(); return; }
    const css = n => getComputedStyle(saiEl('paneSa') || document.documentElement).getPropertyValue(n).trim();
    const c = { ink: css('--ink') || '#1d1d1f', muted: css('--muted') || '#6e6e73', line: css('--card-line') || css('--line') || '#e6e6eb', card: css('--card') || '#fff', bar: css('--brand') || '#0071e3' };
    const anim = saiFx();
    const fmt = v => saiFmt(v, SA.metric, true);
    try {
      Object.values(SAI.charts).forEach(ch => { try { ch.dispose(); } catch (e) { /* gone */ } });
      SAI.charts = {};
      bars.innerHTML = ''; trend.innerHTML = '';
      const b = SAI.charts.bars = window.echarts.init(bars, null, { renderer: 'svg' });
      b.setOption({
        animation: anim, grid: { left: 8, right: 56, top: 6, bottom: 6, containLabel: true },
        tooltip: { trigger: 'item', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 }, formatter: p => `<b>${saiEsc(p.name)}</b><br>${saiEsc(fmt(p.value))} in ${saiEsc(m.month)}<br><span style="opacity:.7">click: show it in the table</span>` },
        xAxis: { type: 'value', show: false },
        yAxis: { type: 'category', inverse: true, data: m.top10.map(x => x.label || x.name), axisLabel: { color: c.ink, fontSize: 11, width: 150, overflow: 'truncate' }, axisTick: { show: false }, axisLine: { show: false } },
        series: [{ type: 'bar', data: m.top10.map(x => x.v), barMaxWidth: 16, itemStyle: { color: c.bar, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: c.muted, fontSize: 11, formatter: p => fmt(p.value) }, cursor: 'pointer' }],
      });
      b.on('click', p => saiReveal((m.top10[p.dataIndex] || {}).name || p.name));
      saiTrendDraw(c, anim);
    } catch (e) { plain(); }
  });
}
function saiTrendDraw(c, anim) {
  const trend = saiEl('saiTrend');
  if (!trend || typeof window === 'undefined' || !window.echarts) return;
  const d = saiTrendData();
  const fmt = v => saiFmt(v, SA.metric, true);
  const series = [];
  d.series.forEach(s => {
    series.push({ type: 'line', name: s.name, data: s.now, smooth: true, symbolSize: 5, lineStyle: { color: s.color, width: 2.5 }, itemStyle: { color: s.color } });
    if (s.ly.some(v => v != null)) series.push({ type: 'line', name: s.name + ' (last year)', data: s.ly, smooth: true, symbol: 'none', lineStyle: { color: s.color, width: 1.5, type: 'dotted', opacity: 0.75 }, itemStyle: { color: s.color } });
  });
  let ch = SAI.charts.trend;
  if (!ch) ch = SAI.charts.trend = window.echarts.init(trend, null, { renderer: 'svg' });
  ch.setOption({
    animation: anim, grid: { left: 8, right: 16, top: 34, bottom: 6, containLabel: true },
    legend: { top: 0, data: d.series.map(s => s.name), textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    tooltip: { trigger: 'axis', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 }, valueFormatter: v => (v == null ? '—' : fmt(v)) },
    xAxis: { type: 'category', data: d.labels, axisLabel: { color: c.muted, fontSize: 10 }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: c.muted, fontSize: 10, formatter: fmt }, splitLine: { lineStyle: { color: c.line } } },
    series,
  }, true);
}
/** A bar clicked: the row highlighted and scrolled to — shown even when it is outside the top 15 (or the search hid it). */
function saiReveal(name) {
  if (!name) return;
  SAI.reveal.add(name);
  SAI.only = '';
  SAI.flash = name;
  const f = saiEl('saFilter');
  if (f && f.value && !String(name).toLowerCase().includes(f.value.trim().toLowerCase())) f.value = '';
  if (typeof renderSa === 'function') renderSa();
}
// A table row clicked: in / out of the trend chart (up to 5; the oldest pick goes when a 6th comes).
function saiToggleTrend(name) {
  const t = SAI.trend || (SAI.trend = []);
  const i = t.indexOf(name);
  if (i >= 0) t.splice(i, 1);
  else { t.push(name); if (t.length > SAI_M.trendMax) t.shift(); }
  if (typeof renderSa === 'function') renderSa();
  const css = n => getComputedStyle(saiEl('paneSa') || document.documentElement).getPropertyValue(n).trim();
  if (SAI.charts.trend) saiTrendDraw({ ink: css('--ink') || '#1d1d1f', muted: css('--muted') || '#6e6e73', line: css('--card-line') || '#e6e6eb', card: css('--card') || '#fff' }, saiFx());
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const on = s => (e.target && e.target.closest ? e.target.closest(s) : null);
    if (!on('#paneSa')) return;
    const b = on('#paneSa [data-sai], #paneSa [data-sai-card], #paneSa [data-sai-bar], #saTable tr[data-sa-row]');
    if (!b) return;
    if (b.dataset.sai === 'more') { SAI.all = true; return renderSa(); }
    if (b.dataset.sai === 'fewer') { SAI.all = false; SAI.reveal = new Set(); return renderSa(); }
    if (b.dataset.sai === 'clear') { SAI.only = ''; return renderSa(); }
    if (b.dataset.saiCard) { SAI.only = SAI.only === b.dataset.saiCard ? '' : b.dataset.saiCard; return renderSa(); }
    if (b.dataset.saiBar) return saiReveal(b.dataset.saiBar);
    if (b.dataset.saRow != null) return saiToggleTrend(b.dataset.saRow);
    return undefined;
  });
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => Object.values(SAI.charts).forEach(ch => { try { ch.resize(); } catch (e) { /* gone */ } }));
}
