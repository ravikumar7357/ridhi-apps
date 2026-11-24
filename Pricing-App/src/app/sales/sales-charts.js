/* ================= SALES · THE SALES DASHBOARD AS CHAPTERS: charts, motion and background (23 Nov 2026) =================
 * Screens: the Sales Dashboard (pane paneSales), built EXACTLY like the approved preview Pricing-App/design/sales-dashboard/ — seven
 *          chapters: Sales today (the six numbers + sparklines) · This week, explained (sales/sales-insight.js) · Every day vs last year ·
 *          Your busiest days (calendar heatmap + top products this month) · Your weekly rhythm (weekday polar + channel donut) ·
 *          Month by month · The details (the tables and the Custom Range, folded). A slim sticky bar, one row: brand on the left;
 *          Numbers checked, Refresh today, Story / Compact on the right. Motion and light / dark are the app's own ✨ (#fxBtn, the
 *          Dashboard's switch: localStorage selloraDashFx) and 🌙 (#themeBtn) in the menu bar — this page follows them.
 * Does: DRAWS ONLY. Every number on the page is still written by renderSales (sales/sales-dashboard.js) into the same ids; the charts
 *   read the Sales Dashboard's own sums — nothing is worked out a second way:
 *     sales / units per day   sdDays(channel) — the nightly history with Seller Central's totals laid over (All = Ridhi + CPC + Shopify)
 *     ad spend per day        Seller Central's ad totals (matchAds SP + SB + SD) on the days Amazon has published — the Overview's rule
 *     last year (daily)       the same WEEKDAY a year back (364 days); the cards and tables keep the same calendar date
 *     monthly                 sdSum, the same windows as the Monthly Comparison table
 *     calendar · weekdays     the same days (the last 13 weeks; the average of the last 8 weeks' complete days)
 *     where sales come from   sdDays of Ridhi, CPC and Shopify, this month so far (= each channel's MTD)
 *     top products            the nightly per-product days (dailyAsin, read by sales-insight.js viLoad), grouped by parent; ▲/▼ only
 *                             while those days still hold the same days last month
 *     event labels            deals typed in the Deal Calendar (D_PLAN) for the brand on view, and last week's biggest mover — never more
 *                             than 3, never overlapping, never made up
 *   LIBRARIES (jsDelivr, loaded only when the Sales Dashboard opens, each optional): ECharts 5.5.1 (every chart), and — only with motion
 *   on — GSAP 3.12.5 + ScrollTrigger (the same build the Dashboard uses, so one GSAP on the page) and Lenis 1.1.13 (smooth scroll).
 *   MOTION: chapter headings word by word, cards rise and scale in, each chart made when its card comes into view (its own animation),
 *   the numbers count up, faint trend lines draw in, the glow takes each chapter's colour, ~30 data dots rise (canvas, paused when
 *   hidden). ✨ off, reduced motion → all shown at once; phone or Compact → a still background. Story / Compact and ✨ switch at once
 *   (no reload) and are remembered (localStorage sdxMode; ✨ = selloraDashFx). Leaving the page stops Lenis, the triggers and the dots.
 *   NEVER HIDDEN: an entrance on screen that has not started within 1 s (or not finished 3 s later) is shown at once, and a chart on
 *   screen is made; if the motion libraries fail or throw, the page is drawn as with ✨ off (sdcWatch, sdcShowNow, sdcStill).
 * Main functions: sdcRender (from renderSales), sdcSetup / sdcTeardown, sdcMake (the charts), sdcValueOf, sdcNotes, sdcSparks. Every name
 *   starts with sdc / SDC. Tests: tests/sales-charts-test.js. */

const SDC_CDN = {
  echarts: 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
  gsap: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
  st: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js',
  lenis: 'https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js',
};
const sdcLs = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* this visit only */ } } };
// ✨ is the app's one switch (#fxBtn in the menu bar, core/dashboard.js): '0' = off
const sdcFxSaved = () => sdcLs.get('selloraDashFx') !== '0';
const SDC = { metric: 'sales', range: '90', mode: sdcLs.get('sdxMode') === 'compact' ? 'compact' : 'story', fx: sdcFxSaved(),
  charts: {}, made: {}, last: null, started: false, up: false, st: [], tw: [], lenis: null, tick: null, dotsRaf: 0, dots: null, lines: false, ech: null, mot: null, gen: 0,
  rev: [], io: null, refT: 0 };
const SDC_TABLES_LS = 'sdTablesOpen';
const SDC_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SDC_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SDC_NF = new Intl.NumberFormat('en-US');
const sdcEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const sdcDay = iso => `${SDC_MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const sdcDowOf = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
const sdcMoney = v => (v < 0 ? '−$' : '$') + SDC_NF.format(Math.round(Math.abs(v)));
const sdcK = v => (Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v));
const sdcPane = () => (typeof document !== 'undefined' && document.getElementById ? document.getElementById('paneSales') : null);
const sdcShown = () => { const p = sdcPane(); return !!p && !p.classList.contains('hide'); };
const sdcReduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sdcPhone = () => typeof innerWidth === 'number' && innerWidth < 760;
const sdcMotion = () => SDC.fx && !sdcReduce();
const sdcBgMotion = () => sdcMotion() && !sdcPhone() && SDC.mode === 'story';

/* ----- the numbers per day (read, never worked out anew) ----- */
const sdcChans = () => (SD_CH === 'ALL' ? ['SP', 'CPC', 'SHOP'] : [SD_CH]);
/** day → value for the channel on view: sales (0) or units (1) from sdDays, ad spend from matchAds; null for a day nobody holds. */
function sdcValueOf(metric) {
  if (metric === 'ads') {
    const brands = SD_CH === 'ALL' ? ['SP', 'CPC'] : SD_CH === 'SHOP' ? [] : [SD_CH];
    const ads = typeof T_MATCH !== 'undefined' && T_MATCH.ads && T_MATCH.ads.d;
    if (!ads || !brands.length) return () => null;
    return day => {
      let s = null;
      brands.forEach(b => {
        const k = ads[b] && ads[b][day];
        if (!k || !k.sp) return;                    // Sponsored Products is the bulk: without it the day is not known (as the Overview)
        s = (s || 0) + [k.sp, k.sb, k.sd].filter(Boolean).reduce((t, a) => t + (Number(a[2]) || 0), 0);
      });
      return s == null ? null : Math.round(s * 100) / 100;
    };
  }
  const i = metric === 'units' ? 1 : 0;
  const maps = sdcChans().map(ch => sdDays(ch));
  return day => {
    let s = null;
    maps.forEach(m => { const v = m[day]; if (v) s = (s || 0) + (Number(v[i]) || 0); });
    return s;
  };
}
const sdcFmt = (metric, v, short) => {
  if (v == null) return '—';
  if (metric === 'units') return SDC_NF.format(Math.round(v));
  if (short && Math.abs(v) >= 1000) return '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1000).toFixed(Math.abs(v) >= 1e4 ? 0 : 1) + 'k');
  return '$' + SDC_NF.format(Math.round(v));
};

/* ----- the event labels: real deals and the week's biggest mover — at most 3, never overlapping (two rows) ----- */
function sdcNotes(days, vals, xOf, yOf, metric) {
  const out = [];
  const inView = d => d >= days[0] && d <= days[days.length - 1];
  const peakIn = (a, b) => {
    let best = -1;
    days.forEach((d, i) => { if (d >= a && d <= b && vals[i] != null && (best < 0 || vals[i] > vals[best])) best = i; });
    return best;
  };
  try {
    const brand = SD_CH === 'SP' || SD_CH === 'CPC' ? SD_CH : SD_CH === 'ALL' ? 'ALL' : null;
    const res = metric === 'sales' && brand && typeof viFor === 'function' && typeof VI !== 'undefined' && VI.data ? viFor(brand) : null;
    if (res && res.ok && res.movers.length) {
      const m = res.movers[0];
      const i = peakIn(res.wk.L, sdShift(res.wk.L, 6));
      if (i >= 0) out.push({ i, text: `${m.name.slice(0, 28)}${m.name.length > 28 ? '…' : ''} ${viMoney(m.d, true)}`, tip: `Last week's biggest mover: ${m.name} ${viMoney(m.d, true)} — ${m.driver.t}`, k: 'mover' });
    }
  } catch (e) { /* no mover label */ }
  try {
    if (typeof D_PLAN !== 'undefined' && D_PLAN && typeof dPlanSpan === 'function') {
      const bmap = typeof dBrandOf === 'function' ? dBrandOf() : new Map();
      Object.entries(D_PLAN).forEach(([key, p]) => {
        if (!p || !p.t) return;
        const at = key.lastIndexOf('|');
        if (at < 0) return;
        const parent = key.slice(0, at), span = dPlanSpan(key.slice(at + 1), p);
        if (!(inView(span.start) || inView(span.end))) return;
        const b = bmap.get(parent) || '';
        if (SD_CH === 'SHOP' || ((SD_CH === 'SP' || SD_CH === 'CPC') && b !== SD_CH)) return;
        const i = peakIn(span.start, span.end);
        if (i < 0) return;
        const name = (b && typeof parentName === 'function' && parentName(b, parent, '')) || parent;
        const type = String(p.t).charAt(0) + String(p.t).slice(1).toLowerCase();
        out.push({ i, text: `${type}${p.v ? ' ' + p.v + '%' : ''} · ${String(name).slice(0, 22)}${String(name).length > 22 ? '…' : ''}`,
          tip: `${p.t}${p.v ? ' ' + p.v + '%' : ''} — ${name} (${parent}), ${span.start} → ${span.end} (Deal Calendar)`, k: 'deal', v: vals[i] });
      });
    }
  } catch (e) { /* no deal labels */ }
  const deals = out.filter(n => n.k === 'deal').sort((a, b) => (b.v || 0) - (a.v || 0));
  const picked = [];
  out.filter(n => n.k === 'mover').concat(deals).forEach(n => {
    if (picked.length >= 3) return;
    const w = n.text.length * 6.4 + 18, x = xOf(n.i);
    const row = [0, 1].find(r => !picked.some(p => p.row === r && Math.abs(p.x - x) < (p.w + w) / 2 + 6));
    if (row == null) return;
    picked.push(Object.assign(n, { x, y: yOf(vals[n.i]), w, row }));
  });
  return picked;
}

/* ----- 1. the KPI sparklines: the last 30 days of sales, each card's own days drawn strong (the preview's sparkSvg) ----- */
function sdcSparks(today) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  const from = sdShift(today, -29), yest = sdShift(today, -1), month = today.slice(0, 8) + '01';
  const val = sdcValueOf('sales');
  const days = Array.from({ length: 30 }, (_, i) => sdShift(from, i));
  const vals = days.map(d => val(d) || 0);
  const W = 200, H = 34, max = Math.max(1, ...vals);
  const xy = i => [(i / 29 * W).toFixed(1), (H - 2 - vals[i] / max * (H - 6)).toFixed(1)];
  const all = vals.map((v, i) => (i ? 'L' : 'M') + xy(i).join(',')).join('');
  const own = { today: [today, today], yest: [yest, yest], seven: [sdShift(yest, -6), yest], mtd: [month, today], proj: [month, yest], ytd: [from, today] };
  document.querySelectorAll('#paneSales [data-spark]').forEach(el => {
    const [a, b] = own[el.dataset.spark] || [from, today];
    let path = '', on = false;
    days.forEach((d, i) => { if (d >= a && d <= b) { path += (on ? 'L' : 'M') + xy(i).join(','); on = true; } else on = false; });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${all}L${W},${H}L0,${H}Z"/>`
      + `<path d="${all}" style="opacity:.35"/><path d="${path || all}"/></svg>`;
    el.title = 'Daily sales, the last 30 days';
  });
  const y = document.getElementById('sdYestp');
  if (y) y.textContent = sdcDay(yest);
}

/* ----- the charts (ECharts), each made when its card comes into view ----- */
const sdcCss = n => getComputedStyle(sdcPane()).getPropertyValue(n).trim();
const sdcColours = () => ({ ink: sdcCss('--sx-ink'), muted: sdcCss('--sx-muted'), line: sdcCss('--sx-line'), blue: sdcCss('--sx-blue'), ly: sdcCss('--sx-ly'),
  card: sdcCss('--sx-card'), up: sdcCss('--sx-up'), down: sdcCss('--sx-down'), chip: sdcCss('--sx-chip'), font: sdcCss('--sx-font') });
const sdcBase = c => ({ animation: sdcMotion(), textStyle: { fontFamily: c.font, color: c.muted },
  tooltip: { backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 }, extraCssText: 'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.14);' } });
const sdcAxisY = (c, fmt) => ({ type: 'value', splitNumber: 4, axisLabel: { color: c.muted, formatter: fmt }, splitLine: { lineStyle: { color: c.line } }, axisLine: { show: false }, axisTick: { show: false } });
const sdcPct = (a, b) => (a != null && b ? (a - b) / b * 100 : null);
const sdcPctHtml = (c, p) => `<b style="color:${p == null ? c.muted : p < 0 ? c.down : c.up}">${p == null ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%'}</b>`;

const SDC_MAKERS = {
  daily(c, today, el) {
    const metric = SD_CH === 'SHOP' && SDC.metric === 'ads' ? 'sales' : SDC.metric;
    const from = SDC.range === 'ytd' ? today.slice(0, 4) + '-01-01' : sdShift(today, -(Number(SDC.range) - 1));
    const days = []; for (let d = from; d <= today; d = sdShift(d, 1)) days.push(d);
    const val = sdcValueOf(metric);
    const ty = days.map(val), ly = days.map(d => val(sdShift(d, -364)));
    if (!ty.some(v => v != null)) return { empty: metric === 'ads' ? 'No ad spend from Seller Central for these days yet.' : 'No data yet.' };
    const n = days.length;
    // today is still running: its piece is dashed and apart, so a part day never reads as a fall
    const partial = n > 1 && ty[n - 1] != null && ty[n - 2] != null;
    const tyMain = ty.map((v, i) => (partial && i === n - 1 ? null : v));
    const tyToday = ty.map((v, i) => (partial && i >= n - 2 ? v : null));
    const fmt = v => sdcFmt(metric, v);
    const W = Math.max(300, (el && el.clientWidth) || 900) - 80;
    const notes = sdcNotes(days, tyMain, i => i / Math.max(1, n - 1) * W, v => v, metric);
    const note = document.getElementById('sdcNote');
    if (note) note.textContent = metric === 'ads'
      ? 'Ad spend: Seller Central\'s ad totals (Sponsored Products + Brands + Display), on the days Amazon has published them. Last year: the same weekday a year back.'
      : 'US Pacific days; today is still running (dashed). Last year: the same weekday a year back (364 days), so a Saturday sits beside a Saturday.';
    return Object.assign(sdcBase(c), {
      grid: { left: 56, right: 18, top: 50, bottom: 34 },
      tooltip: Object.assign(sdcBase(c).tooltip, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: c.muted, type: 'dashed' } },
        formatter: ps => { const i = ps[0].dataIndex, d = days[i], a = ty[i], b = ly[i], lyD = sdShift(d, -364);
          return `<b>${SDC_DOW[sdcDowOf(d)]}, ${sdcDay(d)}</b>${d === today ? ' · so far' : ''}<br>This year <b>${a == null ? '—' : fmt(a)}</b><br>`
            + `Last year · ${SDC_DOW[sdcDowOf(lyD)]}, ${sdcDay(lyD)} ${lyD.slice(0, 4)} <b>${b == null ? '—' : fmt(b)}</b><br>vs last year ${sdcPctHtml(c, sdcPct(a, b))}`; } }),
      xAxis: { type: 'category', data: days, boundaryGap: false, axisLabel: { color: c.muted, formatter: sdcDay, hideOverlap: true }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
      yAxis: sdcAxisY(c, v => (metric === 'units' ? SDC_NF.format(v) : sdcK(v))),
      series: [
        { name: 'Last year', type: 'line', data: ly, smooth: 0.35, symbol: 'none', connectNulls: false, lineStyle: { color: c.ly, width: 2, type: [6, 5] }, z: 1 },
        { name: 'This year', type: 'line', data: tyMain, smooth: 0.35, symbol: 'none', connectNulls: false, lineStyle: { color: c.blue, width: 2.5 }, z: 2,
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c.blue + '40' }, { offset: 1, color: c.blue + '00' }] } },
          markPoint: { symbol: 'circle', symbolSize: 9, itemStyle: { color: c.card, borderColor: c.blue, borderWidth: 2 },
            label: { show: true, position: 'top', distance: 10, color: c.ink, fontSize: 11, fontWeight: 600, backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 10, padding: [3, 8], formatter: p => p.data.text },
            tooltip: { formatter: p => sdcEsc(p.data.tip) },
            data: notes.map(a => ({ coord: [days[a.i], tyMain[a.i]], text: a.text, tip: a.tip, label: { offset: [0, -a.row * 24] }, itemStyle: a.k === 'mover' ? { color: c.card, borderColor: c.down, borderWidth: 2 } : undefined })) } },
        { name: 'Today so far', type: 'line', data: tyToday, symbol: 'none', lineStyle: { color: c.blue, width: 2, type: [2, 4] }, z: 2, tooltip: { show: false } },
      ],
      animationDuration: 1600, animationEasing: 'cubicOut',
    });
  },
  heat(c, today) {
    const val = sdcValueOf('sales'), units = sdcValueOf('units');
    const start = sdShift(today, -sdcDowOf(today) - 7 * 12);
    const data = [], rows = [];
    let max = 1;
    for (let w = 0; w < 13; w++) {
      rows.push(sdcDay(sdShift(start, w * 7)));
      for (let k = 0; k < 7; k++) {
        const d = sdShift(start, w * 7 + k), v = d > today ? null : val(d);
        if (v == null) continue;
        max = Math.max(max, v);
        data.push({ value: [k, w, Math.round(v * 100) / 100], units: units(d), date: d });
      }
    }
    if (!data.length) return { empty: 'No data yet.' };
    return Object.assign(sdcBase(c), {
      grid: { left: 52, right: 8, top: 26, bottom: 8 },
      tooltip: Object.assign(sdcBase(c).tooltip, { formatter: p => `<b>${SDC_DOW[p.value[0]]}, ${sdcDay(p.data.date)}</b><br>${sdcMoney(p.value[2])} · ${p.data.units == null ? '—' : SDC_NF.format(p.data.units)} units${p.data.date === today ? ' (so far)' : ''}` }),
      xAxis: { type: 'category', data: SDC_DOW, position: 'top', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.muted }, splitArea: { show: false } },
      yAxis: { type: 'category', data: rows, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.muted, fontSize: 11 } },
      visualMap: { show: false, min: 0, max, inRange: { color: [c.chip, c.blue] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 7, borderColor: c.card, borderWidth: 4 }, emphasis: { itemStyle: { borderColor: c.ink, borderWidth: 2 } },
        animationDelay: i => i * 9, animationDuration: 500 }],
    });
  },
  top(c, today) {
    const sub = document.getElementById('sdxTopSub');
    const say = t => { if (sub) sub.textContent = t; };
    if (SD_CH === 'SHOP') { say('Products from the Amazon accounts.'); return { empty: 'Shopify has no per-product days in Sellora — pick Ridhi, CPC or All.' }; }
    const D = typeof VI !== 'undefined' && VI.data && VI.data.days;
    if (!D || !D.d) { say('This month so far.'); return { empty: typeof VI !== 'undefined' && VI.busy ? 'Reading the per-product days…' : 'The per-product days are not read yet.' }; }
    const brands = SD_CH === 'ALL' ? ['SP', 'CPC'] : [SD_CH];
    const upTo = D.upTo && D.upTo < today ? D.upTo : sdShift(today, -1);
    const mStart = today.slice(0, 8) + '01';
    if (upTo < mStart) { say('This month so far.'); return { empty: 'No per-product day of this month yet — the nightly run brings yesterday.' }; }
    const dom = +upTo.slice(8, 10);
    const pm = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1));
    const pmDays = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).getUTCDate();
    const pStart = pm.toISOString().slice(0, 10), pEnd = sdShift(pStart, Math.min(dom, pmDays) - 1);
    const held = !!D.from && D.from <= pStart;
    const g = {};
    Object.entries(D.d).forEach(([asin, byDay]) => {
      const b = (D.brand && D.brand[asin]) || '';
      if (!brands.includes(b)) return;
      const parent = typeof wParentOf === 'function' ? wParentOf(asin) : asin;
      const k = b + '|' + parent;
      const o = g[k] || (g[k] = { name: (typeof viNameOf === 'function' && viNameOf(parent, asin, b)) || parent, now: 0, was: 0, u: 0 });
      Object.entries(byDay || {}).forEach(([day, v]) => {
        if (day >= mStart && day <= upTo) { o.now += Number(v[1]) || 0; o.u += Number(v[0]) || 0; }
        else if (held && day >= pStart && day <= pEnd) o.was += Number(v[1]) || 0;
      });
    });
    const P = Object.values(g).filter(o => o.now > 0).sort((a, b) => b.now - a.now).slice(0, 8)
      .map(o => ({ name: String(o.name).replace(/^~\s*/, ''), now: Math.round(o.now * 100) / 100, u: o.u, p: held && o.was ? Math.round((o.now - o.was) / o.was * 100) : null }));
    say(held ? `This month to ${sdcDay(upTo)} (the nightly per-product days), against the same days last month.`
      : `This month to ${sdcDay(upTo)} (the nightly per-product days). Last month's same days are past those 45 days, so no change % today.`);
    if (!P.length) return { empty: 'No product has sold this month yet.' };
    return Object.assign(sdcBase(c), {
      grid: { left: 172, right: 118, top: 4, bottom: 4 },
      tooltip: Object.assign(sdcBase(c).tooltip, { formatter: p => `<b>${sdcEsc(P[p.dataIndex].name)}</b><br>${sdcMoney(p.value)} · ${SDC_NF.format(P[p.dataIndex].u)} units`
        + (P[p.dataIndex].p == null ? '' : ` · ${P[p.dataIndex].p < 0 ? '▼' : '▲'} ${Math.abs(P[p.dataIndex].p)}% vs the same days last month`) }),
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', inverse: true, data: P.map(p => p.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.ink, fontSize: 13, width: 160, overflow: 'truncate', align: 'right', margin: 12 } },
      series: [{ type: 'bar', data: P.map(p => p.now), barWidth: 16, showBackground: true, backgroundStyle: { color: c.chip, borderRadius: 8 },
        itemStyle: { color: c.blue, borderRadius: 8 },
        label: { show: true, position: 'right', distance: 10, formatter: p => { const x = P[p.dataIndex].p; return `{v|${sdcMoney(p.value)}}` + (x == null ? '' : `  {${x < 0 ? 'd' : 'u'}|${x < 0 ? '▼' : '▲'}${Math.abs(x)}%}`); },
          rich: { v: { color: c.ink, fontWeight: 600, fontSize: 13 }, u: { color: c.up, fontWeight: 700, fontSize: 12 }, d: { color: c.down, fontWeight: 700, fontSize: 12 } } },
        animationDelay: i => i * 90, animationDuration: 900, animationEasing: 'cubicOut' }],
    });
  },
  polar(c, today) {
    const val = sdcValueOf('sales');
    const sum = [0, 0, 0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 1; i <= 56; i++) { const d = sdShift(today, -i), v = val(d); if (v == null) continue; sum[sdcDowOf(d)] += v; n[sdcDowOf(d)]++; }
    const v = sum.map((s, i) => (n[i] ? Math.round(s / n[i]) : 0));
    if (!v.some(Boolean)) return { empty: 'No data yet.' };
    const best = v.indexOf(Math.max(...v));
    const lab = document.getElementById('sdxBest');
    if (lab) lab.innerHTML = `Average of the last 8 weeks — <b>${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][best]}</b> sell most (${sdcMoney(v[best])}).`;
    return Object.assign(sdcBase(c), {
      polar: { radius: ['14%', '82%'] },
      angleAxis: { type: 'category', data: SDC_DOW, startAngle: 90, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false }, axisLabel: { color: c.muted, fontWeight: 600 } },
      radiusAxis: { axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: c.line } } },
      tooltip: Object.assign(sdcBase(c).tooltip, { formatter: p => `<b>${SDC_DOW[p.dataIndex]}</b><br>${sdcMoney(p.value)} on an average day` }),
      series: [{ type: 'bar', coordinateSystem: 'polar', roundCap: true, barWidth: '62%', data: v.map((x, i) => ({ value: x, itemStyle: { color: i === best ? c.blue : c.blue + '55' } })),
        animationDuration: 1500, animationEasing: 'elasticOut', animationDelay: i => i * 70 }],
    });
  },
  donut(c, today) {
    const mS = today.slice(0, 8) + '01';
    const part = ch => { const m = sdDays(ch); let s = 0; Object.keys(m).forEach(d => { if (d >= mS && d <= today) s += Number(m[d][0]) || 0; }); return Math.round(s * 100) / 100; };
    const parts = [['Amazon · Ridhi', part('SP'), c.blue], ['Amazon · CPC', part('CPC'), '#8b5cf6'], ['Shopify', part('SHOP'), '#f59e0b']];
    const total = parts.reduce((s, p) => s + p[1], 0);
    if (!total) return { empty: 'No sales this month yet.' };
    return Object.assign(sdcBase(c), {
      tooltip: Object.assign(sdcBase(c).tooltip, { trigger: 'item', formatter: p => `<b>${p.name}</b><br>${sdcMoney(p.value)} · ${p.percent}%` }),
      legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { color: c.muted } },
      title: { text: sdcK(total), subtext: 'this month', left: 'center', top: '36%', textStyle: { color: c.ink, fontSize: 26, fontWeight: 700 }, subtextStyle: { color: c.muted, fontSize: 12 } },
      series: [{ type: 'pie', radius: ['56%', '78%'], center: ['50%', '45%'], avoidLabelOverlap: true, label: { show: false },
        itemStyle: { borderRadius: 10, borderColor: c.card, borderWidth: 4 }, data: parts.map(p => ({ name: p[0], value: p[1], itemStyle: { color: p[2] } })),
        animationType: 'scale', animationEasing: 'elasticOut', animationDuration: 1300 }],
    });
  },
  month(c, today) {
    const yr = today.slice(0, 4), lyr = String(Number(yr) - 1), ty = [], ly = [];
    for (let m = 0; m < 12; m++) {
      const mm = String(m + 1).padStart(2, '0');
      const last = new Date(Date.UTC(Number(yr), m + 1, 0)).toISOString().slice(0, 10);
      ty.push(`${yr}-${mm}-01` > today ? null : sdSum(`${yr}-${mm}-01`, last)[0]);   // the Monthly Comparison table's own sums
      ly.push(sdSum(`${lyr}-${mm}-01`, `${lyr}-${mm}-31`)[0]);
    }
    return Object.assign(sdcBase(c), {
      grid: { left: 56, right: 14, top: 20, bottom: 30 },
      tooltip: Object.assign(sdcBase(c).tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.chip + '88' } },
        formatter: ps => { const i = ps[0].dataIndex, a = ty[i], b = ly[i];
          return `<b>${SDC_MON[i]}</b><br>${yr} <b>${a == null ? '—' : sdcMoney(a)}</b><br>${lyr} <b>${sdcMoney(b)}</b><br>change ${sdcPctHtml(c, sdcPct(a, b))}`; } }),
      xAxis: { type: 'category', data: SDC_MON, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false }, axisLabel: { color: c.muted } },
      yAxis: sdcAxisY(c, sdcK),
      series: [
        { name: 'This year', type: 'bar', data: ty, barGap: '12%', barWidth: '28%', itemStyle: { color: c.blue, borderRadius: [7, 7, 0, 0] }, animationDelay: i => i * 70 },
        { name: 'Last year', type: 'bar', data: ly, barWidth: '28%', itemStyle: { color: c.ly + '99', borderRadius: [7, 7, 0, 0] }, animationDelay: i => i * 70 + 35 },
      ],
      animationDuration: 900, animationEasing: 'cubicOut',
    });
  },
};
/** Make (or remake) one chart from the data on view. */
function sdcMake(key) {
  const el = document.querySelector(`#paneSales [data-chart="${key}"]`);
  if (!el || !SDC.last) return;
  if (!window.echarts) { el.innerHTML = `<div class="sdx-chart-fail">${SDC.ech ? 'The chart library did not load — the numbers above are still right.' : 'Loading the chart…'}</div>`; return; }
  let opt;
  try { opt = SDC_MAKERS[key](sdcColours(), SDC.last.today, el); } catch (e) { opt = { empty: 'This chart could not be drawn: ' + ((e && e.message) || e) }; }
  if (opt.empty) {
    if (SDC.charts[key]) { SDC.charts[key].dispose(); delete SDC.charts[key]; }
    el.innerHTML = `<div class="sdx-chart-fail">${sdcEsc(opt.empty)}</div>`;
    SDC.made[key] = true;
    sdcRefresh();
    return;
  }
  if (SDC.charts[key] && SDC.charts[key].getDom() !== el) { SDC.charts[key].dispose(); delete SDC.charts[key]; }
  if (!SDC.charts[key]) { el.innerHTML = ''; SDC.charts[key] = window.echarts.init(el, null, { renderer: 'svg' }); }
  SDC.charts[key].setOption(opt, true);
  SDC.made[key] = true;
  sdcRefresh();
}
const sdcRemakeMade = () => Object.keys(SDC.made).forEach(sdcMake);
const sdcMakeAll = () => document.querySelectorAll('#paneSales [data-chart]').forEach(el => sdcMake(el.dataset.chart));

/* ----- the background: trend lines per chapter, the glow, the rising data dots ----- */
function sdcTrendLines() {
  if (SDC.lines) return;
  SDC.lines = true;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  document.querySelectorAll('#paneSales .sdx-lines').forEach(svg => {
    let html = '';
    for (let k = 0; k < 3; k++) {
      let y = 330 - k * 60 - rnd() * 30, d = `M0,${y.toFixed(0)}`;
      for (let x = 80; x <= 1200; x += 80) { y = Math.max(30, y - 8 - rnd() * 26 + rnd() * 14); d += ` S${x - 40},${(y + 18).toFixed(0)} ${x},${y.toFixed(0)}`; }
      html += `<path d="${d}" pathLength="1" stroke-opacity="${(0.9 - k * 0.25).toFixed(2)}"/>`;
    }
    svg.innerHTML = html;
  });
}
function sdcDotsStart() {
  const cv = document.getElementById('sdxDots'), ctx = cv && cv.getContext && cv.getContext('2d');
  if (!ctx || SDC.dotsRaf) return;
  if (!SDC.dots) SDC.dots = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), r: 1.5 + Math.random() * 2.5, s: 0.00012 + Math.random() * 0.00028 }));
  const step = () => {
    SDC.dotsRaf = 0;
    if (!SDC.up || !sdcBgMotion() || document.hidden || !sdcShown()) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    if (cv.width !== innerWidth * devicePixelRatio) { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = sdcCss('--sx-dot');
    SDC.dots.forEach(p => { p.y -= p.s; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); } ctx.beginPath(); ctx.arc(p.x * cv.width, p.y * cv.height, p.r * devicePixelRatio, 0, 6.283); ctx.fill(); });
    SDC.dotsRaf = requestAnimationFrame(step);
  };
  SDC.dotsRaf = requestAnimationFrame(step);
}

/* ----- the libraries: only when the Sales Dashboard opens ----- */
function sdcScript(url) {
  return new Promise(res => {
    const s = document.createElement('script');
    let done = false;
    const end = ok => { if (!done) { done = true; res(ok); } };
    s.src = url; s.async = true; s.onload = () => end(true); s.onerror = () => end(false);
    document.head.appendChild(s);
    setTimeout(() => end(false), 20000);
  });
}
function sdcLoadCharts() {
  if (window.echarts) return Promise.resolve(true);
  if (!SDC.ech) SDC.ech = sdcScript(SDC_CDN.echarts).then(() => !!window.echarts);
  return SDC.ech;
}
function sdcLoadMotion() {
  if (!SDC.mot) SDC.mot = (async () => {
    if (!window.gsap) await sdcScript(SDC_CDN.gsap);                       // the Dashboard's build: one GSAP on the page
    if (window.gsap && !window.ScrollTrigger) await sdcScript(SDC_CDN.st);
    if (!window.Lenis) await sdcScript(SDC_CDN.lenis);
    try { if (window.gsap && window.ScrollTrigger) window.gsap.registerPlugin(window.ScrollTrigger); } catch (e) { /* plain */ }
    return !!(window.gsap && window.ScrollTrigger);
  })();
  return SDC.mot;
}

/* ----- the scroll story: set up when the page shows, torn down when it goes (or when Story / Compact or ✨ change) ----- */
const sdcTrig = t => { if (t) SDC.st.push(t); return t; };
const sdcTween = t => { if (t) { SDC.tw.push(t); if (t.scrollTrigger) SDC.st.push(t.scrollTrigger); } return t; };
// A heading's words as spans (the per-word fallback of SplitText). The heading keeps its own text, and is split again if its words were
// ever moved out of order.
function sdcWords(h) {
  if (!h.dataset.text) h.dataset.text = h.textContent.trim();
  if (!h.querySelector('.sdx-w') || h.textContent !== h.dataset.text) h.innerHTML = h.dataset.text.split(' ').map(w => `<span class="sdx-w">${sdcEsc(w)}</span>`).join(' ');
  return h.querySelectorAll('.sdx-w');
}
// The six numbers count up from 0 to the text renderSales wrote and END ON THAT EXACT TEXT. The true text is kept on the element
// (_sdxFinal) with what this wrote last (_sdxWrote): a newer number renderSales writes meanwhile stops the count and stays.
function sdcCountEnd(el, restore) {
  if (!el._sdxCount) return;
  try { el._sdxCount.kill(); } catch (e) { /* gone */ }
  if (restore && el.textContent === el._sdxWrote) el.textContent = el._sdxFinal;
  el._sdxCount = null;
}
function sdcCountUp() {
  document.querySelectorAll('#paneSales .sdx-kpi-v').forEach((el, i) => {
    if (el._sdxCount || !window.gsap) return;
    const final = el.textContent;
    if (!/^\$[\d,]+$/.test(final)) return;
    const to = Number(final.replace(/[^0-9]/g, ''));
    const o = { v: 0 };
    el._sdxFinal = final;
    el._sdxWrote = '$0';
    el.textContent = el._sdxWrote;
    el._sdxCount = window.gsap.to(o, { v: to, duration: 1.4, delay: i * 0.08, ease: 'power3.out',
      onUpdate() { if (el.textContent !== el._sdxWrote) { sdcCountEnd(el, false); return; } el._sdxWrote = '$' + Math.round(o.v).toLocaleString('en-US'); el.textContent = el._sdxWrote; },
      onComplete() { sdcCountEnd(el, true); } });
    // a safety net: GSAP's clock runs on screen frames, which a hidden tab (or a busy page) pauses — the number never stays at $0
    const tw = el._sdxCount;
    setTimeout(() => { if (el._sdxCount === tw) sdcCountEnd(el, true); }, (1.4 + i * 0.08) * 1000 + 1500);
  });
}
/* ----- NEVER HIDDEN: the safety net under the motion ----- */
// What the motion leaves on an element; cleared by hand (never through GSAP: on a hidden pane GSAP lifts an element out to measure it).
const SDC_MOVED = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'visibility', 'stroke-dasharray', 'stroke-dashoffset'];
const sdcUnstyle = els => els.forEach(el => { if (!el || !el.style) return; SDC_MOVED.forEach(p => el.style.removeProperty(p)); if (el._gsap) el._gsap.uncache = 1; });
// One entrance (a heading's words, its line, a card), kept with the element whose scroll starts it.
const sdcReveal = (tw, at, els) => {
  if (tw && at) { SDC.rev.push({ tw, at, els: Array.from(els && els.length != null ? els : [els]), done: false }); if (SDC.io) SDC.io.observe(at); }
  return sdcTween(tw);
};
/** Show one entrance now, as with ✨ off: its trigger and tween go, and the element is left as drawn. */
function sdcShowNow(r) {
  if (r.done) return;
  r.done = true;
  try { if (r.tw.scrollTrigger) r.tw.scrollTrigger.kill(); } catch (e) { /* gone */ }
  try { r.tw.kill(); } catch (e) { /* gone */ }
  sdcUnstyle(r.els);
}
const sdcProg = tw => { try { return tw.progress(); } catch (e) { return 0; } };
// An element has been on screen for 1 s: an entrance that has not started is shown now (a paused clock, a trigger measured before
// the page settled, anything), and one still not finished 3 s later too; a chart not made yet is made.
function sdcNetCheck(el) {
  if (!SDC.up) return;
  const mine = SDC.rev.filter(r => r.at === el && !r.done);
  const stuck = window.gsap && window.gsap.globalTimeline && window.gsap.globalTimeline.paused();
  mine.forEach(r => { if (stuck || sdcProg(r.tw) === 0) sdcShowNow(r); });
  if (el.dataset && el.dataset.chart && !SDC.made[el.dataset.chart]) sdcLoadCharts().then(() => { if (SDC.up && !SDC.made[el.dataset.chart]) sdcMake(el.dataset.chart); });
  const gen = SDC.gen;
  if (mine.some(r => !r.done)) setTimeout(() => { if (SDC.up && gen === SDC.gen) mine.forEach(r => { if (sdcProg(r.tw) < 1) sdcShowNow(r); }); }, 3000);
}
/** Watch every element that starts an entrance or holds a chart, anywhere on screen — also a card peeking in at the bottom, below
 *  where its ScrollTrigger starts (top 85–90%), which would otherwise sit there invisible. */
function sdcWatch() {
  if (typeof IntersectionObserver !== 'function') return false;
  SDC.io = new IntersectionObserver(list => list.forEach(e => {
    const el = e.target;
    if (!e.isIntersecting) { clearTimeout(el._sdxNet); el._sdxNet = 0; return; }
    if (!el._sdxNet) el._sdxNet = setTimeout(() => { el._sdxNet = 0; if (SDC.io) SDC.io.unobserve(el); sdcNetCheck(el); }, 1000);
  }), { rootMargin: '0px 0px -16px 0px' });
  new Set(SDC.rev.map(r => r.at)).forEach(el => SDC.io.observe(el));
  document.querySelectorAll('#paneSales [data-chart]').forEach(el => { if (!SDC.made[el.dataset.chart]) SDC.io.observe(el); });
  return true;
}
/** Everything that moves stops, and every element is left as drawn (teardown, and a motion that failed). */
function sdcUnmove() {
  // a number caught mid count-up shows its own text again
  document.querySelectorAll('#paneSales .sdx-kpi-v').forEach(el => sdcCountEnd(el, true));
  if (SDC.io) { try { SDC.io.disconnect(); } catch (e) { /* gone */ } SDC.io = null; }
  SDC.rev.forEach(r => { clearTimeout(r.at._sdxNet); r.at._sdxNet = 0; });
  document.querySelectorAll('#paneSales [data-chart]').forEach(el => { clearTimeout(el._sdxNet); el._sdxNet = 0; });
  SDC.rev = [];
  clearTimeout(SDC.refT);
  SDC.st.forEach(t => { try { t.kill(); } catch (e) { /* gone */ } });
  SDC.tw.forEach(t => { try { t.kill(); } catch (e) { /* gone */ } });
  SDC.st = []; SDC.tw = [];
  if (SDC.lenis) {
    try { window.gsap.ticker.remove(SDC.tick); window.gsap.ticker.lagSmoothing(500, 33); SDC.lenis.destroy(); } catch (e) { /* gone */ }
    SDC.lenis = null; SDC.tick = null;
  }
  if (SDC.dotsRaf) { cancelAnimationFrame(SDC.dotsRaf); SDC.dotsRaf = 0; }
  sdcUnstyle(document.querySelectorAll('#paneSales .sdx-card, #paneSales .sdx-card > *, #paneSales .sdx-h .sdx-w, #paneSales .sdx-sub, #paneSales .sdx-lines, #paneSales .sdx-lines path, #viBox .sdx-mv-bar i'));
}
/** The motion failed (a library missing, or it threw): the page as with ✨ off — every element shown, every chart made. */
function sdcStill(gen) {
  sdcUnmove();
  const p = sdcPane();
  if (p) p.classList.add('sdx-still');
  sdcLoadCharts().then(() => { if (SDC.up && gen === SDC.gen) sdcMakeAll(); });
}
/** Content above changed height (a chart, "This week, explained", another brand, fonts): ScrollTrigger measures again. */
function sdcRefresh() {
  if (!SDC.up || !SDC.st.length || typeof window === 'undefined' || !window.ScrollTrigger) return;
  clearTimeout(SDC.refT);
  SDC.refT = setTimeout(() => { try { if (SDC.up && SDC.st.length) window.ScrollTrigger.refresh(); } catch (e) { /* the safety net still shows it */ } }, 150);
}

function sdcAnimate() {
  const gsap = window.gsap, ST = window.ScrollTrigger;
  const story = SDC.mode === 'story';
  // GSAP's clock is shared with the Dashboard: if anything left it paused, every entrance would stay at its first frame
  if (gsap.globalTimeline.paused()) gsap.globalTimeline.resume();
  if (window.Lenis && !sdcPhone() && !SDC.lenis) {
    try {
      SDC.lenis = new window.Lenis({ lerp: 0.11, smoothWheel: true });
      SDC.lenis.on('scroll', ST.update);
      SDC.tick = t => { if (SDC.lenis) SDC.lenis.raf(t * 1000); };
      gsap.ticker.add(SDC.tick);
      gsap.ticker.lagSmoothing(0);
    } catch (e) { SDC.lenis = null; }
  }
  document.querySelectorAll('#paneSales .sdx-ch').forEach(ch => {
    const h = ch.querySelector('.sdx-h'), sub = ch.querySelector('.sdx-sub'), cards = ch.querySelectorAll('.sdx-card');
    if (story) {
      const words = sdcWords(h);
      sdcReveal(gsap.from(words, { yPercent: 110, opacity: 0, duration: 0.9, stagger: 0.07, ease: 'power4.out', scrollTrigger: { trigger: h, start: 'top 88%' } }), h, words);
      if (sub) sdcReveal(gsap.from(sub, { y: 24, opacity: 0, duration: 0.9, delay: 0.15, ease: 'power3.out', scrollTrigger: { trigger: h, start: 'top 88%' } }), h, sub);
    }
    cards.forEach((card, i) => {
      sdcReveal(gsap.from(card, { y: story ? 60 : 16, scale: story ? 0.96 : 1, opacity: 0, duration: story ? 1.1 : 0.5, delay: 0.12 + i * 0.1, ease: 'power3.out',
        scrollTrigger: { trigger: card, start: 'top 90%' } }), card, card);
      if (story && !sdcPhone() && card.firstElementChild) sdcTween(gsap.fromTo(card.firstElementChild, { y: 14 }, { y: -14, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } }));
    });
    const lines = ch.querySelectorAll('.sdx-lines path');
    if (lines.length && sdcBgMotion()) {
      gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
      sdcTween(gsap.to(lines, { strokeDashoffset: 0, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: ch, start: 'top 90%', end: 'center 40%', scrub: 1 } }));
      sdcTween(gsap.to(ch.querySelector('.sdx-lines'), { y: -60, ease: 'none', scrollTrigger: { trigger: ch, start: 'top bottom', end: 'bottom top', scrub: true } }));
    }
    sdcTrig(ST.create({ trigger: ch, start: 'top 55%', end: 'bottom 55%', onToggle: self => { if (self.isActive) { const g = document.getElementById('sdxGlow'); if (g) g.style.backgroundColor = ch.dataset.glow; } } }));
  });
  sdcTrig(ST.create({ trigger: '#paneSales .sdx-kpis', start: 'top 85%', once: true, onEnter: sdcCountUp }));
  sdcTrig(ST.create({ trigger: '#viBox', start: 'top 80%', once: true, onEnter: () => {
    const bars = document.querySelectorAll('#viBox .sdx-mv-bar i');
    if (bars.length) sdcReveal(gsap.from(bars, { scaleX: 0, duration: 0.9, stagger: 0.06, ease: 'power3.out' }), document.getElementById('viBox'), bars);
  } }));
  // each chart is made as its card comes into view, so its own animation plays there
  document.querySelectorAll('#paneSales [data-chart]').forEach(el => {
    if (SDC.made[el.dataset.chart]) return;
    sdcTrig(ST.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => sdcLoadCharts().then(() => { if (SDC.up) sdcMake(el.dataset.chart); }) }));
  });
  ST.refresh();
  // fonts arriving late move everything below them: measure again
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(sdcRefresh); } catch (e) { /* measured once */ }
}
function sdcApplyState() {
  const p = sdcPane();
  if (!p) return;
  p.dataset.mode = SDC.mode;
  p.classList.toggle('sdx-still', !sdcBgMotion());
  document.querySelectorAll('#sdxMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === SDC.mode)));
  const side = document.querySelector('.side');
  const top = side && getComputedStyle(side).position === 'sticky' ? side.offsetHeight : 0;
  p.style.setProperty('--sdx-top', top + 'px');
  sdcEdges();
}
// The trend lines' box (styles.css .sdx-lines-box): the page's visible width, from the chapters' left edge — so they bleed to the
// page's edges and never past them (no sideways scroll). Measured when the page shows and whenever its width changes.
function sdcEdges() {
  const p = sdcPane();
  if (!p || !sdcShown() || !p.querySelector) return;
  const ch = p.querySelector('.sdx-ch'), root = document.documentElement;
  if (!ch || !root) return;
  const l = Math.round(ch.getBoundingClientRect().left), vw = root.clientWidth;
  if (p.style.getPropertyValue('--sdx-l') !== l + 'px') p.style.setProperty('--sdx-l', l + 'px');
  if (p.style.getPropertyValue('--sdx-vw') !== vw + 'px') p.style.setProperty('--sdx-vw', vw + 'px');
}
/** The page is on screen: the background, the charts and (with motion) the scroll story. */
async function sdcSetup() {
  if (SDC.up || !sdcShown()) return;
  SDC.up = true;
  const gen = ++SDC.gen;                             // a set-up overtaken by a newer one (two quick switches) stops
  sdcApplyState();
  sdcTrendLines();
  let animate = false;
  try { animate = sdcMotion() && typeof IntersectionObserver === 'function' && await sdcLoadMotion(); } catch (e) { animate = false; }
  if (!SDC.up || gen !== SDC.gen) return;           // left again, or switched again, while loading
  if (animate) {
    try { sdcAnimate(); sdcWatch(); if (sdcBgMotion()) sdcDotsStart(); }
    catch (e) { sdcStill(gen); }                    // the motion threw: everything shown, as with ✨ off
  } else { await sdcLoadCharts(); if (SDC.up && gen === SDC.gen) sdcMakeAll(); }
}
/** The page went away, or Story / Compact / ✨ changed: everything that moves stops, and every element is left as drawn. */
function sdcTeardown() {
  SDC.up = false;
  SDC.gen++;
  sdcUnmove();
}
const sdcRestart = () => { sdcTeardown(); sdcApplyState(); sdcSetup(); };

/* ----- the tables' fold ----- */
function sdcTablesSet(open) {
  const box = document.getElementById('sdTables'), btn = document.getElementById('sdTablesBtn');
  if (!box || !btn) return;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide tables ▴' : 'Show tables ▾';
}
function sdcSeg(id, attr, val) {
  const g = typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null;
  if (g && g.querySelectorAll) g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
}

/* ----- once: the controls, leaving / coming back, light / dark ----- */
function sdcStart() {
  if (SDC.started || typeof document === 'undefined' || !document.addEventListener || !sdcPane()) return;
  SDC.started = true;
  sdcTablesSet(sdcLs.get(SDC_TABLES_LS) === '1');
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#sdcMetric [data-m], #sdcRange [data-r], #sdTablesBtn, #sdxMode [data-m], #fxBtn') : null;
    if (!t || t.disabled) return;
    // the app's ✨ (core/dashboard.js has already saved the new choice on the button itself): this page follows at once
    if (t.id === 'fxBtn') { const on = sdcFxSaved(); if (on !== SDC.fx) { SDC.fx = on; sdcRestart(); } return; }
    if (t.id === 'sdTablesBtn') {
      const open = document.getElementById('sdTables').hidden;
      sdcLs.set(SDC_TABLES_LS, open ? '1' : '0');
      sdcTablesSet(open);
      sdcRefresh();
      return;
    }
    if (t.closest('#sdxMode')) {
      if (SDC.mode !== t.dataset.m) { SDC.mode = t.dataset.m; sdcLs.set('sdxMode', SDC.mode); sdcRestart(); setTimeout(() => Object.values(SDC.charts).forEach(c => c.resize()), 60); }
      return;
    }
    if (t.dataset.m) { SDC.metric = t.dataset.m; sdcSeg('sdcMetric', 'm', SDC.metric); }
    if (t.dataset.r) { SDC.range = t.dataset.r; sdcSeg('sdcRange', 'r', SDC.range); }
    if (SDC.made.daily) sdcMake('daily');
  });
  // the page shown / hidden (core/nav.js showTab toggles .hide): set up or tear down
  if (typeof MutationObserver === 'function') new MutationObserver(() => { if (sdcShown()) sdcSetup(); else sdcTeardown(); }).observe(sdcPane(), { attributes: true, attributeFilter: ['class'] });
  // the page's width changed (a window resize, a scrollbar coming or going): the trend lines' box follows
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => sdcEdges()).observe(sdcPane());
  // light / dark (the app's 🌙, #themeBtn): the charts take the new colours
  const recolour = () => { if (Object.keys(SDC.charts).length) setTimeout(sdcRemakeMade, 30); };
  if (typeof MutationObserver === 'function') new MutationObserver(recolour).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolour); } catch (e) { /* an old browser */ }
  let rT = 0;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { Object.values(SDC.charts).forEach(c => c.resize()); sdcApplyState(); }, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && SDC.up && sdcBgMotion()) sdcDotsStart(); });
}

/** renderSales calls this after its own numbers: the sparklines, the controls, and the charts already made redrawn from the new data. */
function sdcRender(today, yr, lyr) {
  SDC.last = { today, yr, lyr };
  sdcStart();
  sdcSeg('sdBrand', 'ch', SD_CH);
  const ads = typeof document !== 'undefined' && document.querySelector ? document.querySelector('#sdcMetric [data-m="ads"]') : null;
  if (ads) { ads.disabled = SD_CH === 'SHOP'; ads.title = SD_CH === 'SHOP' ? 'Shopify has no ad spend in Sellora' : 'Seller Central\'s ad totals per day'; }
  sdcSeg('sdcMetric', 'm', SD_CH === 'SHOP' && SDC.metric === 'ads' ? 'sales' : SDC.metric);
  sdcSeg('sdcRange', 'r', SDC.range);
  sdcSparks(today);
  if (typeof window !== 'undefined' && window.echarts) sdcRemakeMade();
  if (typeof alStripPaint === 'function') { try { alStripPaint(); } catch (e) { /* the strip only */ } }   // "Needs attention" (sales/sales-alerts.js)
  if (sdcShown()) { if (SDC.up) sdcRefresh(); sdcSetup(); }
}
/** The per-product days arrived (sales/sales-insight.js viLoad): the top products and the event labels take them. */
function sdcAfterVi() {
  if (SDC.made.top) sdcMake('top');
  if (SDC.made.daily) sdcMake('daily');
  sdcRefresh();                                      // "This week, explained" has its new height
}
