/* ================= ADS · AD CONSOLE EXTRAS: ten boxes, two line charts and Campaign performance =================
 * Screens: Ad Console (tab 'trends', pane paneTrends). Nothing here runs by itself: renderTrends (ads/placement.js)
 * calls ADSX.draw as its very last step, inside a try, so the card, chart and table it draws are on screen whatever
 * happens here. Each of the three blocks below draws inside its own try and hides itself if it cannot; the old KPI
 * card (tKpis) is hidden only while the boxes are showing, and comes straight back if they fail.
 * Does: the boxes (tBoxes) show the same totals as the table's Total column — T_ROWS over renderTrends' own total and
 * adTot — with the change from the previous COMPLETE period (never the running one: the rule wWeekDone applies) and a
 * sparkline. The two charts (tCharts) draw ad spend against ad sales, and ACoS against TACoS, over the complete periods
 * that have ad figures. Campaign performance (tCamp) rolls the 30-day ad-group cache that Search Terms reads up per
 * campaign and judges each one against the break-even ACoS Search Terms already works out (cpPace, cpBreakEven), with
 * what is left after the ads. READ-ONLY: nothing here saves anything, and nothing changes anything at Amazon.
 * The bar chart (tBars) redraws the old Sales / Ad spend / TACOS chart with both axes named, where the ad figures start,
 * the spike and the hover tip, with ACoS beside TACOS on the right axis; the old chart's card is hidden only while it shows.
 * Each chart has its own period (Day / Week / Month / Qtr) and "Last N" in its own header, apart from the page's — the
 * boxes and Performance Overview follow the page's; a chart keeps its own for the visit. Both the page and each chart can also
 * take "Custom dates…" (any two days): only the days inside count, and the edge periods hold just those days. Campaign
 * performance and Recommendation stay on the nightly 30 days — those reports come as one 30-day block, not by the day.
 * A chart's legend switches its lines on and off. A campaign row opens to its products, each with its FBA stock and days of
 * it (tinted: out, under 7, under 15 days); Recommendation can narrow Campaign performance to the campaigns it names.
 * The Sessions box reads Business Reports' weekly sessions (the 'sessions' cache PPC & Organic reads), once per visit.
 * Recommendation (ads/ads-health.js) reads the same campaign rows through ADSX.state, and each brand's daily ad spend through
 * ADSX.trendSum, and is drawn from here, inside a try.
 * Main functions: ADSX.draw, ADSX.state, ADSX.trendSum — and inside them drawBoxes, paintBoxes, drawCharts, lineChart, campLoad, campRows, drawCamp. */
const ADSX = (() => {
  /* THE TWO LINES A CAMPAIGN IS JUDGED AGAINST.
   * Break-even: the ACoS at which an ad sale brings in nothing — the price less the unit cost, returns, referral and FBA,
   * BEFORE overhead and salary. Overhead and salary are paid whether or not an ad runs, so cutting an ad that is under
   * this line loses money rather than saves it.
   * Target: the same less Profit & Margin's overhead and salary % — exactly the break-even Search Terms shows (cpBreakEven).
   * Under it, an ad sale also pays its share of overhead and salary. Between the two, it covers its costs, not its share. */
  const ohPts = () => (Number(PF_MODEL.oh) || 0) + (Number(PF_MODEL.sal) || 0);
  // Fewer orders than this in the 30 days and a campaign's ACoS is too noisy to judge.
  const MIN_ORDERS = 10;
  // THE ACoS RANGE every campaign is judged by: 25–35% is the good range; over 35% is high — worth lowering bids; under 25% is
  // room to grow — worth a small bid increase where the stock allows. Unit costs, where Profit & Margin has them, only add the
  // target and break-even ticks on each campaign's bar.
  const BAND = { low: 25, high: 35 };
  // TACoS at or under this is the account's goal: the dashed line on the ACoS & TACoS chart and the TACOS box's red line.
  const TACOS_T = 20;
  // A chart narrower than this is hidden or still being laid out (a side panel opening, the window resizing): it waits for
  // the ResizeObserver rather than drawing with a negative plot width.
  const MIN_W = 160;

  /* ---------- speed: the product sums worked out once, not on every click ----------
   * A product's pace and price are Search Terms' (cpPace): the last four finished weeks of its sales. cpPace asks
   * wWeekDone about every week of every product, and wWeekDone reads the Pacific date afresh each time — on a full
   * catalogue that was seconds per click. Here each week is asked once, each product is summed once, and the results are
   * kept until the weekly figures, the unit costs, the fee model or the day change. The sums are cpPace's, line for line. */
  const PACE = { key: '', map: new Map(), done: {}, day: '', dayAt: 0 };
  // Start of every pass that reads products: drop the kept sums when what they were made from has changed.
  function paceFresh() {
    if (Date.now() - PACE.dayAt > 60000) {
      PACE.day = sdToday();
      PACE.dayAt = Date.now();
    }
    const m = PF_MODEL || {};
    const key = [PACE.day, WEEKLY.at, WEEKLY.weeks.length, Object.keys(WEEKLY.rows).length, COST_AT, Object.keys(COST).length,
      m.ref, m.fba, m.ret, m.oh, m.sal].join('|');
    if (key !== PACE.key) {
      PACE.key = key;
      PACE.map = new Map();
      PACE.done = {};
    }
    return PACE.key;
  }
  // { perDay, price, tacos, tgt, be } for one ASIN: cpPace's three, and the two lines a campaign is judged against —
  // tgt = cpBreakEven (Search Terms' break-even, after overhead and salary), be = the same before them. Null parts when unknown.
  function lines(a) {
    let out = PACE.map.get(a);
    if (out) return out;
    const r = WEEKLY.rows[a];
    let pace = null;
    if (r && r.weeks) {
      const wks = Object.keys(r.weeks).filter(k => (k in PACE.done ? PACE.done[k] : (PACE.done[k] = wWeekDone(k)))).sort().slice(-4);
      if (wks.length) {
        let u = 0, rev = 0, spend = 0, spendKnown = false;
        wks.forEach(k => {
          const c = r.weeks[k];
          u += c.u || 0;
          rev += c.rev || 0;
          if (c.spend != null) {
            spend += c.spend;
            spendKnown = true;
          }
        });
        pace = { perDay: u / (wks.length * 7), price: u > 0 ? rev / u : null, tacos: spendKnown && rev > 0 ? spend / rev * 100 : null };
      }
    }
    const tgt = cpBreakEven(a, pace && pace.price);
    out = { perDay: pace ? pace.perDay : null, price: pace ? pace.price : null, tacos: pace ? pace.tacos : null,
      tgt, be: tgt == null ? null : tgt + ohPts() };
    PACE.map.set(a, out);
    return out;
  }
  // Campaigns that are meant to cost more for a while, by their name: launch, ranking, seasonal and event campaigns.
  const INVEST = /launch|new product|preset|ranking|season|christmas|xmas|valentine|diwali|halloween|thanksgiving|prime ?day|black friday|cyber monday|bfcm/i;
  // Campaign rows shown before "Show all".
  const CAMP_ROWS = 8;
  // The ACoS chart gets a break-even line only when at least this share of the ad sales has a unit cost behind it.
  const BE_MIN_COVER = 0.5;

  // The ten boxes: the T_ROWS key (sessions has none — it comes from the weekly sessions cache), the colour (--adx-…),
  // whether up is good (null: neither — more spend is not bad by itself), the ⓘ text, and the red line.
  const BOXES = [
    { k: 'sales', c: 'sales', up: true, tip: 'Every sale in the Orders workbooks, over all the periods in view.' },
    { k: 'spend', c: 'spend', up: null, tip: 'Sponsored Products ad spend, over the periods that have ad figures.' },
    { k: 'adSales', c: 'adsales', up: true, tip: 'The sales Amazon credits to a Sponsored Products click within 30 days (Campaign Manager shows 7 days, so it reads lower there).' },
    { k: 'acos', c: 'acos', up: false, bad: BAND.high, tip: `Ad spend ÷ ad sales. ${BAND.low}–${BAND.high}% is the good range.` },
    { k: 'tacos', c: 'tacos', up: false, bad: TACOS_T, tip: `Ad spend ÷ ALL the sales of the same days. ${TACOS_T}% or under is the goal.` },
    { k: 'roas', c: 'roas', up: true, tip: 'Ad sales ÷ ad spend: what one dollar of ads brings back.' },
    { k: 'organicPct', c: 'org', up: true, tip: 'The sales NOT credited to ads ÷ all the sales of the same days.' },
    { k: 'orders', c: 'orders', up: true, tip: 'Every order in the Orders workbooks, over all the periods in view.' },
    { k: 'sessions', c: 'sessions', up: true, tip: 'Visits to the product pages, ads or not, from Amazon\'s Business Reports. Weekly figures: a month or quarter adds up the weeks that start in it, and the Day view has none.' },
    { k: 'clicks', c: 'clicks', up: true, tip: 'Clicks on Sponsored Products ads, over the periods that have ad figures.' },
  ];
  // The boxes' icons: line drawings in the box's colour (stroke only, so they follow the theme).
  const ICON = {
    sales: '<path d="M3 20h18"/><rect x="5" y="10" width="3" height="7" rx="1"/><rect x="10.5" y="5" width="3" height="12" rx="1"/><rect x="16" y="12" width="3" height="5" rx="1"/>',
    spend: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 15h2"/>',
    adSales: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/>',
    acos: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>',
    tacos: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
    roas: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    organicPct: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15H5Z"/><path d="M5 19 13 11"/>',
    orders: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 7.5v9L12 21l9-4.5v-9M12 12v9"/>',
    sessions: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    clicks: '<path d="M9 9l10 4.2-4.4 1.4-1.4 4.4L9 9Z"/><path d="M4.5 4.5 6 6M9 3v2M3 9h2"/>',
  };
  // A campaign's verdict → its icon. adx-none has none (no unit cost, or no break-even anywhere).
  const STATUS = {
    'adx-good': '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    'adx-warn': '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
    'adx-crit': '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    'adx-low': '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    'adx-none': '',
    'adx-inv': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  };

  // What the last draw was given, kept for a redraw on resize and when the campaign figures arrive.
  let LAST = null;
  // Campaign performance: st = idle / loading / ready / failed; ag = the ad-group cache per brand; at = when it was built;
  // all = "Show all" pressed; pbe = the break-even over everything in view, for the ACoS chart (null when too little is costed).
  // ver = bumped when the figures arrive; rows / rowsKey = the last roll-up and what it was made from; sig = what the card
  // last drew, so a click that changes nothing it shows (Day / Week / Month) does not redraw it.
  // only = { keys, t }: the campaigns a suggestion named, when Recommendation has narrowed the list to them; open = the rows
  // opened to their products.
  const CAMP = { st: 'idle', ag: {}, at: '', err: '', all: false, pbe: null, ver: 0, rows: [], rowsKey: '', sig: '', only: null, open: new Set() };
  // The ResizeObserver on the charts, and the width they were last drawn at.
  let RO = null, RO_W = 0;

  /* ---------- small helpers ---------- */
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // The table's own row for a key — its title, its format and how it is worked out.
  const rowOf = k => T_ROWS.find(r => r.k === k);
  // May this account open tab t? The test applyPerms makes.
  const can = t => ME.admin || ME.tabs.includes(t);
  // The brands in view, picked exactly as tSeries picks them, so the ad-brand restriction always applies.
  const brandsInView = () => {
    const b = $('tBrand').value;
    return b === 'ALL' ? adBrands() : [b].filter(x => adBrands().includes(x));
  };
  // The new bar chart on, and the old chart's card off — or the other way round when it cannot draw.
  const bars = (on, e) => {
    if (e) console.warn('[ads-charts]', 'tBars', e);
    try { show('tBars', on); } catch (x) { /* the block itself is missing */ }
    const old = $('tChart').closest('.card');
    if (old) old.classList.toggle('hide', !!on);
  };
  // Show or hide one block.
  const show = (id, on) => $(id).classList.toggle('hide', !on);
  // Say what failed in the console, quietly, and hide the block that was drawing.
  const fail = (id, e) => {
    console.warn('[ads-charts]', id, e);
    try { show(id, false); } catch (x) { /* the block itself is missing */ }
  };
  // Whole dollars, as the table writes them; a minus sign rather than a hyphen.
  const dollars = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  // $1.2M / $86k / $940 — for the axes and the line ends only; the boxes, tips and table keep whole dollars.
  const dollarsShort = v => {
    const a = Math.abs(v);
    const t = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : String(Math.round(a));
    return (v < 0 ? '−' : '') + '$' + t;
  };

  /* ---------- periods ---------- */
  // The last day of period k under T_GRAN, as yyyy-MM-dd.
  function periodEnd(k) {
    if (T_GRAN === 'day') return k;
    if (T_GRAN === 'week') return sdShift(k, 6);
    if (T_GRAN === 'month') {
      const [y, m] = k.split('-').map(Number);
      return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    const [y, q] = k.split('-Q').map(Number);
    return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  }
  // Has period k finished? Its last day is before today in PT — the rule wWeekDone applies to weeks.
  const isDone = k => periodEnd(k) < sdToday();
  // The x-axis name of a period: "Oct 25" for a day or a week (its Sunday), "Oct '26" or "Q3 '26" otherwise.
  const shortName = k => {
    if (T_GRAN !== 'day' && T_GRAN !== 'week') return tPeriodLabel(k);
    const d = new Date(k + 'T00:00:00Z');
    return W_MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
  };

  /* ---------- the boxes ---------- */
  // A sparkline: the line and a faint fill under it, stretched to the box (it has no text, so stretching is safe). Smooth
  // but never past a real value (the same curve as the charts).
  function spark(vals) {
    if (vals.length < 2) return '<div class="adx-spark"></div>';
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const d = curve(vals.map((v, i) => [i / (vals.length - 1) * 100, 29 - (v - lo) / span * 25]));
    return `<svg class="adx-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><path class="adx-a" d="${d} L100,32 L0,32 Z"/><path d="${d}"/></svg>`;
  }

  // The coloured change of a box: a ratio moves in points (31.2% → 30.1% is −1.1 pts); money and counts move in per cent.
  function pillOf(now, was, pct, up, kNow, kWas) {
    if (now == null || was == null || !(pct || was !== 0)) return '';
    const d = pct ? now - was : (now / was - 1) * 100;
    const flat = Math.abs(d) < 0.05;
    const cls = flat || up == null ? '' : (d > 0) === up ? ' is-ok' : ' is-bad';
    return `<span class="ui-badge${cls}" title="${esc(tPeriodLabel(kNow))} against ${esc(tPeriodLabel(kWas))}">`
      + `${flat ? '' : d > 0 ? '▲ ' : '▼ '}${Math.abs(d).toFixed(1)}${pct ? ' pts' : '%'}</span>`;
  }
  // The first day of period k under T_GRAN, as yyyy-MM-dd.
  function periodStart(k) {
    if (T_GRAN === 'day' || T_GRAN === 'week') return k;
    if (T_GRAN === 'month') return k + '-01';
    const [y, q] = k.split('-Q').map(Number);
    return `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  }
  // Sessions per period of the brands in view, from the weekly figures: a week counts in the period its Sunday falls in, and a
  // period is known (not null) only when its first week is inside the weeks the cache holds. missing = brands in view with none.
  function sessPer(keys) {
    const brands = brandsInView();
    const have = brands.filter(b => SESS.wk[b] && Object.keys(SESS.wk[b]).length);
    if (!have.length) return null;
    const weeks = [...new Set(have.flatMap(b => Object.keys(SESS.wk[b])))].sort();
    const oldest = weeks[0], newest = weeks[weeks.length - 1], sum = {};
    weeks.forEach(w => {
      const k = tPeriodKey(w);
      sum[k] = (sum[k] || 0) + have.reduce((t, b) => t + (SESS.wk[b][w] || 0), 0);
    });
    const per = {};
    keys.forEach(k => {
      const s = periodStart(k), sun = sdShift(s, (7 - new Date(s + 'T00:00:00Z').getUTCDay()) % 7);
      per[k] = sun >= oldest && sun <= newest && sum[k] != null ? sum[k] : null;
    });
    return { per, missing: brands.filter(b => !have.includes(b)) };
  }
  // The Sessions box. Not one of the table's measures, so it opens nothing.
  function sessBox(b, a, finished, firstPartial, span) {
    const box = (v, pill, note, sp) => `<div class="adx-box adx-static" style="--c:var(--adx-${b.c})">`
      + `<div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.sessions}</svg></span>Sessions<span class="adx-i" title="${esc(b.tip)}">i</span></div>`
      + `<div class="adx-v"><b>${v}</b>${pill}</div><div class="adx-note" title="${esc(note)}">${esc(note)}</div>${sp}</div>`;
    const blank = note => box('—', '', note, spark([]));
    if (!sessRight()) return blank('needs the Product Performance right');
    if (T_GRAN === 'day') return blank('weekly figures: pick Week, Month or Quarter');
    if (SESS.st === 'idle' || SESS.st === 'loading') return blank('loading the sessions…');
    if (SESS.st === 'failed') return blank('the sessions could not be read');
    // (the comparison may read periods outside the view — a view of the last full period compares it with the one before)
    const s = sessPer([...new Set(a.keys.concat(finished))].sort());
    if (!s) return blank('no sessions for these brands yet');
    const known = a.keys.filter(k => s.per[k] != null);
    if (!known.length) return blank('older than the 26 weeks the sessions cover');
    const pts = finished.filter(k => s.per[k] != null);
    const cmp = pts.length > 1 && pts[pts.length - 2] !== firstPartial;
    const pill = cmp ? pillOf(s.per[pts[pts.length - 1]], s.per[pts[pts.length - 2]], false, b.up, pts[pts.length - 1], pts[pts.length - 2]) : '';
    const note = (known.length === a.keys.length ? tSpanName(a.keys.length) : `over ${known.length} of ${span(a.keys.length)} with sessions`)
      + (s.missing.length ? ` · none for ${s.missing.map(x => BRAND_NAME[x] || x).join(', ')}` : '');
    return box(Math.round(known.reduce((t, k) => t + s.per[k], 0)).toLocaleString('en-US'), pill, note, spark(pts.map(k => s.per[k])));
  }

  // The ten boxes, and the line above them (the old card's own heading, so the two can never disagree).
  function drawBoxes(a) {
    const { keys, agg, adKnown, total, adTot, covered } = a;
    const adAny = covered.length > 0;
    const adAll = keys.length > 0 && covered.length === keys.length;
    const span = n => `${n} ${T_GRAN}${n === 1 ? '' : 's'}`;
    // The change and the sparkline read the complete periods in view. A view holding fewer than two of them (the last 1 or 2
    // periods) reads the newest eight complete periods the store has instead — never its first, which may be partial.
    // With custom dates a period cut by either edge holds only some of its days: it is never compared.
    const rg = tRange();
    const cut = k => !!rg.from && (periodStart(k) < rg.from || periodEnd(k) > rg.to);
    const whole = k => isDone(k) && !cut(k);
    const inView = keys.filter(whole), allKeys = Object.keys(agg).sort();
    const finished = inView.length >= 2 ? inView : allKeys.slice(1).filter(whole).slice(-8);
    // Fewer periods than the span asked for means the store starts inside the first one: it may hold only a few of its
    // days, so it is never the period a change is measured against.
    const firstPartial = !rg.from && keys.length < rg.n ? keys[0] : null;
    const boxes = BOXES.map(b => {
      if (b.k === 'sessions') return sessBox(b, a, finished, firstPartial, span);
      const r = rowOf(b.k);
      // --- the value: exactly the table's Total / Avg cell ---
      const v = r.ad ? (adAny ? r.get(adTot) : null) : r.get(total);
      // --- the change: the last complete period against the one before it ---
      const pts = finished.filter(k => !r.ad || adKnown[k]);
      const cmp = pts.length > 1 && pts[pts.length - 2] !== firstPartial;
      const now = cmp ? r.get(agg[pts[pts.length - 1]]) : null;
      const was = cmp ? r.get(agg[pts[pts.length - 2]]) : null;
      const pill = cmp ? pillOf(now, was, r.pct, b.up, pts[pts.length - 1], pts[pts.length - 2]) : '';
      // --- the line under the value ---
      const note = !r.ad || adAll ? tSpanName(keys.length)
        : adAny ? `over ${covered.length} of ${span(keys.length)} with ad figures`
        : 'no ad figures in this span';
      // The ACOS box names the campaigns' break-even once Campaign performance has worked it out (last 30 days).
      const beNote = b.k === 'acos' && CAMP.pbe
        ? `break-even ${CAMP.pbe.be.toFixed(1)}% · target ${CAMP.pbe.tgt.toFixed(1)}% (30 days)` : '';
      const hot = b.bad && v != null && v > b.bad;
      return `<div class="adx-box" style="--c:var(--adx-${b.c})" data-k="${b.k}" role="button" tabindex="0" aria-label="${esc(r.t)}: show it week by week">`
        + `<span class="adx-hint">${esc(T_GRAN)} by ${esc(T_GRAN)} ↓</span>`
        + `<div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[b.k]}</svg></span>${esc(r.t)}<span class="adx-i" title="${esc(b.tip)}">i</span></div>`
        + `<div class="adx-v"><b${hot ? ' class="ui-neg"' : ''}${v == null ? '' : ` data-v="${v}"`}>${v == null ? '—' : tFmt(r, v)}</b>${pill}</div>`
        + `<div class="adx-note" title="${esc(beNote || note)}">${esc(beNote || note)}</div>${spark(pts.map(k => r.get(agg[k])).filter(x => x != null))}</div>`;
    }).join('');
    const head = $('tKpis').querySelector('.kpihead');
    const name = head && head.querySelector('.kpiname'), when = head && head.querySelector('.kpiwhen');
    $('tBoxes').innerHTML = `<div class="adx-meta"><span><b>${name ? name.innerHTML : ''}</b> · the coloured change is the last complete ${T_GRAN} against the one before</span>`
      + `<span>${when ? when.innerHTML : ''}</span></div><div class="adx-boxes">${boxes}</div>`;
    if (!FX.counted) {
      FX.counted = true;
      if (FX.on) countUp();
    }
  }

  /* ---------- a little motion, once: the first look counts up, cards rise in as they scroll into view ---------- */
  // on = motion is allowed (an IntersectionObserver exists and the computer does not ask for reduced motion).
  const FX = { on: false, set: false, counted: false };
  // Mark the blocks that rise into view, once per visit. Nothing here runs after the motion is done.
  function fxSetup() {
    if (FX.set) return;
    FX.set = true;
    try {
      if (typeof IntersectionObserver !== 'function') return;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const io = new IntersectionObserver(list => list.forEach(en => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
        // The boxes rise in once; after that a redraw (another brand, another period) just shows them.
        if (en.target.id === 'tBoxes') setTimeout(() => en.target.classList.add('adx-calm'), 1200);
      }), { rootMargin: '0px 0px -6% 0px' });
      ['tBoxes', 'tHealth', 'tCharts', 'tBars', 'tCamp', 'tPerf'].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.classList.add('adx-reveal');
        io.observe(el);
      });
      // Printing shows everything, whether or not it was ever scrolled to.
      window.addEventListener('beforeprint', () => document.querySelectorAll('#paneTrends .adx-reveal').forEach(el => el.classList.add('is-in')));
      FX.on = true;
    } catch (e) { FX.on = false; }
  }
  // Has this block not risen into view yet? Its lines and bars then draw themselves in as it does.
  const fresh = id => FX.on && !$(id).classList.contains('is-in');
  // Count the boxes' values up from zero over 0.45 s, in the table's own format; the last frame writes the exact figure.
  function countUp() {
    const els = [...document.querySelectorAll('#tBoxes .adx-v>b[data-v]')].map(b => {
      const r = rowOf(b.closest('.adx-box').dataset.k);
      return { b, r, v: Number(b.dataset.v), end: b.textContent };
    });
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      els.forEach(x => {
        if (!x.b.isConnected) return;
        x.b.textContent = k < 1 ? tFmt(x.r, x.v * e) : x.end;
      });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Performance Overview: the table, folded away until asked for ---------- */
  // Open it on one measure (from a box), scroll to it, and light that row up.
  function openPerf(k) {
    const d = $('tPerf');
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const i = T_ROWS.findIndex(r => r.k === k);
    const tr = $('tTable').querySelectorAll('tbody tr')[i];
    if (!tr) return;
    tr.classList.remove('adx-flash');
    void tr.offsetWidth;
    tr.classList.add('adx-flash');
  }
  // Wire the boxes and the fold once.
  function wireUi() {
    const box = $('tBoxes'), perf = $('tPerf');
    if (box && !box.dataset.wired) {
      box.dataset.wired = '1';
      box.addEventListener('click', e => {
        const b = e.target.closest('.adx-box');
        if (b && b.dataset.k && !e.target.closest('.adx-i')) openPerf(b.dataset.k);
      });
      box.addEventListener('keydown', e => {
        const b = e.target.closest('.adx-box');
        if (b && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openPerf(b.dataset.k);
        }
      });
    }
    // Each chart's own period (Day / Week / Month / Qtr) and "Last N": that chart alone redraws.
    ['tCharts', 'tBars'].forEach(id => {
      const el = $(id);
      if (!el || el.dataset.ctl) return;
      el.dataset.ctl = '1';
      el.addEventListener('click', e => {
        // A legend key: its line on or off (never the last one showing).
        const lg = e.target.closest('.adx-lg');
        if (lg && CH[lg.dataset.ch]) {
          const st = CH[lg.dataset.ch], c = lg.dataset.s, all = [...el.querySelectorAll(`.adx-lg[data-ch="${lg.dataset.ch}"]`)].map(x => x.dataset.s);
          if (!st.off[c] && all.filter(x => !st.off[x]).length <= 1) return;
          st.off[c] = !st.off[c];
          lg.classList.toggle('off', st.off[c]);
          lg.setAttribute('aria-pressed', String(!st.off[c]));
          replot(lg.dataset.ch);
          return;
        }
        const b = e.target.closest('.adx-seg button'), ctl = b && b.closest('.adx-ctl');
        const st = ctl && CH[ctl.dataset.ch];
        if (!st || st.g === b.dataset.g) return;
        st.n = tSpanFit(st.g, st.n, b.dataset.g, 2);
        st.g = b.dataset.g;
        ctl.querySelectorAll('.adx-seg button').forEach(x => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        ctl.querySelector('.adx-span').innerHTML = tSpanOptions(st.g, st.n, 2);
        replot(ctl.dataset.ch);
      });
      // Its "Last N" or "Custom dates…" (the two days show, starting from the page's own custom days or the last 30), or one
      // of the two days.
      el.addEventListener('change', e => {
        const ctl = e.target.closest('.adx-ctl'), st = ctl && CH[ctl.dataset.ch];
        if (!st) return;
        const box = ctl.querySelector('.adx-dates'), f = ctl.querySelector('.adx-from'), t = ctl.querySelector('.adx-to');
        if (e.target.classList.contains('adx-span')) {
          const v = e.target.value;
          if (v === 'custom') {
            const pr = tRange(), d = pr.from ? pr : tDates('', '');
            st.from = st.from || d.from;
            st.to = st.to || d.to;
            tDatesFill(f, t, st);
          }
          st.n = v === 'custom' ? v : Number(v) || st.n;
          if (box) box.classList.toggle('hide', v !== 'custom');
        } else if (e.target === f || e.target === t) {
          const r = tDates(f.value, t.value);
          st.from = r.from;
          st.to = r.to;
        } else return;
        replot(ctl.dataset.ch);
      });
    });
    // Opened: the table shows the newest period first, as it always has.
    if (perf && !perf.dataset.wired) {
      perf.dataset.wired = '1';
      perf.addEventListener('toggle', () => {
        if (!perf.open) return;
        const wrap = $('tTable').closest('.xlwrap');
        if (wrap) wrap.scrollLeft = wrap.scrollWidth;
      });
    }
  }

  /* ---------- the two line charts ---------- */
  // A round axis top at or above v, in four equal steps of 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten.
  function niceTop(v) {
    if (!(v > 0)) return 4;
    const step = v / 4, p = Math.pow(10, Math.floor(Math.log10(step)));
    return 4 * [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= step - 1e-9);
  }
  // A smooth path through the points that never overshoots them (monotone cubic), so no peak is invented.
  function curve(p) {
    const f = n => n.toFixed(1);
    if (p.length < 3) return 'M' + p.map(q => f(q[0]) + ',' + f(q[1])).join(' L');
    const n = p.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = p[i + 1][0] - p[i][0];
      m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      t[i] = m[i - 1] * m[i] <= 0 ? 0
        : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    }
    let d = `M${f(p[0][0])},${f(p[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${f(p[i][0] + h)},${f(p[i][1] + t[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - t[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
    }
    return d;
  }

  /**
   * One line chart into el, sized to el's own width so its text stays readable on a phone.
   * series = [{ c: colour, t: name, v: one value per key (null = a gap, never a zero), area }]; opt.money for a $ axis;
   * opt.refs = [{ v, t, cls }] for dashed reference lines; opt.band = { lo, hi } for a shaded range; opt.label for screen
   * readers; opt.short / opt.lab = each key's axis name and tip name, and opt.unit its period, when the chart has its own.
   * One axis, never two.
   */
  function lineChart(el, keys, series, opt) {
    const W = Math.round(el.clientWidth);
    if (W < MIN_W) return;                            // hidden, or not laid out yet — the ResizeObserver draws it once it has a width
    if (keys.length < 2) {
      el.innerHTML = `<div class="ui-empty">Needs two complete ${opt.unit || T_GRAN}s with ad figures — try a longer stretch, or a shorter period.</div>`;
      return;
    }
    // --- the scales ---
    const H = W < 520 ? 210 : 240, L = 50, R = 58, T = 14, B = 26;
    const refs = opt.refs || [];
    const vals = series.flatMap(s => s.v).filter(v => v != null).concat(refs.map(r => r.v));
    const top = niceTop(Math.max(...vals) * 1.04);
    const x = i => L + i * (W - L - R) / (keys.length - 1);
    const y = v => T + (1 - v / top) * (H - T - B);
    const fmt = opt.money ? dollarsShort : v => (Math.round(v * 10) / 10) + '%';
    const full = opt.money ? dollars : v => v.toFixed(1) + '%';
    let g = '';
    // --- four solid hairlines and the y labels ---
    for (let i = 0; i <= 4; i++) {
      const yy = y(top * i / 4);
      g += `<line class="adx-gl" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`
        + `<text x="${L - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${fmt(top * i / 4)}</text>`;
    }
    // --- x labels, counted back from the newest so it is always named, never closer than ~64px ---
    const every = Math.max(1, Math.ceil(keys.length / Math.max(2, Math.floor((W - L - R) / 64))));
    keys.forEach((k, i) => {
      if ((keys.length - 1 - i) % every) return;
      g += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(opt.short ? opt.short[k] : shortName(k))}</text>`;
    });
    // --- a shaded range (the good ACoS range), under the reference lines and the series ---
    if (opt.band) {
      const y1 = y(opt.band.hi), y2 = y(opt.band.lo);
      g += `<rect class="adx-rng" x="${L}" y="${y1.toFixed(1)}" width="${Math.max(0, W - L - R)}" height="${Math.max(0, y2 - y1).toFixed(1)}"/>`;
    }
    // --- reference lines (dashed: a threshold, not a grid): the top one named above its line, the rest below ---
    // (one marked mid is named above its line in the middle instead, clear of the labels at the left and the line ends)
    refs.slice().sort((p, q) => q.v - p.v).forEach((r, i) => {
      const yy = y(r.v);
      g += `<line class="adx-ref ${r.cls || ''}" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`
        + `<text class="adx-reft ${r.cls || ''}" x="${r.mid ? ((L + W - R) / 2).toFixed(1) : L + 6}" y="${(i && !r.mid ? yy + 13 : yy - 5).toFixed(1)}"${r.mid ? ' text-anchor="middle"' : ''}>${esc(r.t)}</text>`;
    });
    // --- the lines: a null breaks the line instead of dropping it to zero ---
    series.forEach(s => {
      const runs = [];
      let run = [];
      s.v.forEach((v, i) => {
        if (v == null) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push([x(i), y(v)]);
      });
      if (run.length) runs.push(run);
      runs.forEach(p => {
        const d = curve(p);
        if (s.area && p.length > 1) {
          g += `<path class="adx-ar" style="--c:var(--adx-${s.c})" d="${d} L${p[p.length - 1][0].toFixed(1)},${y(0).toFixed(1)} L${p[0][0].toFixed(1)},${y(0).toFixed(1)} Z"/>`;
        }
        g += `<path class="adx-ln${opt.anim ? ' adx-draw' : ''}"${opt.anim ? ' pathLength="1"' : ''} style="--c:var(--adx-${s.c})" d="${d}"/>`;
      });
    });
    // --- the newest value of each line, named at its end (pushed apart when they would touch) ---
    const ends = series.map(s => {
      const v = s.v[s.v.length - 1];
      return v == null ? null : { y: y(v), t: fmt(v), c: s.c };
    }).filter(Boolean).sort((p, q) => p.y - q.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => {
      g += `<text class="adx-end" x="${W - R + 8}" y="${(e.y + 4).toFixed(1)}">${esc(e.t)}</text>`;
    });
    series.forEach(s => {
      const v = s.v[s.v.length - 1];
      if (v != null) g += `<circle class="adx-dot" style="--c:var(--adx-${s.c})" cx="${x(keys.length - 1).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"/>`;
    });
    // --- the hover layer: a crosshair that snaps to the nearest period, one dot per line, one tip for all ---
    const dots = series.map(s => `<circle class="adx-dot hide" style="--c:var(--adx-${s.c})" r="4.5"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.label)}">${g}`
      + `<line class="adx-xh hide" y1="${T}" y2="${H - B}"/>${dots}<rect class="adx-hit" x="${L}" y="0" width="${Math.max(0, W - L - R)}" height="${H}"/></svg>`
      + '<div class="adx-tip hide"></div>';
    const svg = el.firstChild, tip = el.lastChild, xh = svg.querySelector('.adx-xh');
    const marks = [...svg.querySelectorAll('circle.adx-dot.hide')];
    svg.addEventListener('pointermove', ev => {
      const box = svg.getBoundingClientRect();
      const px = (ev.clientX - box.left) * W / box.width;
      const i = Math.max(0, Math.min(keys.length - 1, Math.round((px - L) / ((W - L - R) / (keys.length - 1)))));
      xh.setAttribute('x1', x(i));
      xh.setAttribute('x2', x(i));
      xh.classList.remove('hide');
      series.forEach((s, j) => {
        const v = s.v[i];
        marks[j].classList.toggle('hide', v == null);
        if (v != null) {
          marks[j].setAttribute('cx', x(i));
          marks[j].setAttribute('cy', y(v));
        }
      });
      tip.innerHTML = `<div class="adx-tip-h">${esc(opt.lab ? opt.lab[keys[i]] : tPeriodLabel(keys[i]))}</div>`
        + series.map(s => `<div><i style="--c:var(--adx-${s.c})"></i><b>${s.v[i] == null ? '—' : full(s.v[i])}</b> ${esc(s.t)}</div>`).join('');
      tip.classList.remove('hide');
      const at = x(i) * box.width / W;
      tip.style.left = Math.round(at > box.width / 2 ? at - tip.offsetWidth - 12 : at + 12) + 'px';
    });
    svg.addEventListener('pointerleave', () => {
      xh.classList.add('hide');
      tip.classList.add('hide');
      marks.forEach(m => m.classList.add('hide'));
    });
  }

  /* ---------- each chart's own period: its toggle and its "Last N" ---------- */
  // money / pct are the two line charts, bars the bar chart. Each keeps its own period and stretch for the visit, apart from
  // the page's (which the boxes and Performance Overview follow); a new period keeps about the same stretch of time.
  // n is a number, or 'custom' with from / to; off = the lines switched off in its legend.
  const CH = { money: { g: 'week', n: 26, off: {} }, pct: { g: 'week', n: 26, off: {} }, bars: { g: 'week', n: 26, off: {} } };
  const PLOT = { money: 'tChartMoney', pct: 'tChartPct', bars: 'tBarsPlot' };
  const GRANS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Qtr']];
  // Run fn with the page's period swapped for g, so every helper that reads T_GRAN (period keys, labels, "finished") reads
  // g instead. Synchronous, and always put back.
  function withGran(g, fn) {
    const keep = T_GRAN;
    T_GRAN = g;
    try { return fn(); } finally { T_GRAN = keep; }
  }
  // One chart's periods: the last n under its own period, for the brands in view, from the store the boxes read — each with
  // its label, its short name and whether it has finished, worked out now (the hover tip runs later, outside withGran).
  function seriesOf(st) {
    return withGran(st.g, () => {
      const own = st.n === 'custom', rg = own ? tDates(st.from, st.to) : null;
      const s = tSeries(own ? rg : { n: 1e9 });
      const keys = own ? s.keys : Object.keys(s.agg).sort().slice(-st.n);
      const covered = keys.filter(k => s.adKnown[k]);
      const sum = list => {
        const t = new Array(T_LEN).fill(0);
        list.forEach(k => { for (let i = 0; i < T_LEN; i++) t[i] += s.agg[k][i]; });
        return t;
      };
      // part = a period cut by the custom dates: it holds only the days inside them.
      const lab = {}, short = {}, done = {}, part = {};
      keys.forEach(k => {
        part[k] = own && (periodStart(k) < rg.from || periodEnd(k) > rg.to);
        lab[k] = tPeriodLabel(k) + (part[k] ? ' · part' : '');
        short[k] = shortName(k);
        done[k] = isDone(k);
      });
      return { g: st.g, keys, agg: s.agg, adKnown: s.adKnown, covered, total: sum(keys), adTot: sum(covered), lab, short, done, part,
        off: st.off || {}, rg };
    });
  }
  // A chart's own controls: the period, then how much of it.
  function ctlHtml(id) {
    const st = CH[id];
    return `<div class="adx-ctl" data-ch="${id}"><div class="adx-seg" role="group" aria-label="Period">`
      + GRANS.map(([g, t]) => `<button type="button" data-g="${g}"${st.g === g ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${t}</button>`).join('')
      + `</div><select class="adx-span" aria-label="How much history">${tSpanOptions(st.g, st.n, 2)}</select>`
      + `<span class="adx-dates${st.n === 'custom' ? '' : ' hide'}"><input type="date" class="adx-from" aria-label="From" value="${esc(st.n === 'custom' ? st.from : '')}">`
      + `<span aria-hidden="true">→</span><input type="date" class="adx-to" aria-label="To" value="${esc(st.n === 'custom' ? st.to : '')}"></span></div>`;
  }
  // A chart card's head: title and its own line under it, its controls; then anything extra, then the legend.
  const chartHead = (id, title, legend, extra) => `<div class="adx-ch-head"><div class="adx-ch-tt"><h3 class="ui-card-title">${title}</h3>`
    + `<div class="ui-note adx-ch-sub" data-sub="${id}"></div></div>${ctlHtml(id)}</div>${extra || ''}${legend ? `<div class="adx-legend">${legend}</div>` : ''}`;
  const legendKey = (c, t, sq) => `<span><i${sq ? ' class="adx-sq"' : ''} style="--c:var(--adx-${c})"></i>${t}</span>`;
  // A legend key that switches its line on and off in chart id.
  const legendBtn = (id, c, t) => {
    const off = !!CH[id].off[c];
    return `<button type="button" class="adx-lg${off ? ' off' : ''}" data-ch="${id}" data-s="${c}" aria-pressed="${!off}" title="Show or hide ${t}">`
      + `<i style="--c:var(--adx-${c})"></i>${t}</button>`;
  };

  // The two line charts' cards, then each one's plot.
  function drawCharts() {
    const el = $('tCharts');
    const pctKey = legendBtn('pct', 'acos', 'ACoS') + legendBtn('pct', 'tacos', 'TACoS')
      + `<span><i class="adx-rng"></i>ACoS ${BAND.low}–${BAND.high}% range</span><span><i class="adx-be"></i>${BAND.high}% high</span>`
      + `<span><i class="adx-tacr"></i>TACoS ${TACOS_T}% goal</span>`;
    el.innerHTML = `<div class="card adx-chart">${chartHead('money', 'Spend &amp; ad sales', legendBtn('money', 'spend', 'Ad spend') + legendBtn('money', 'adsales', 'Ad sales'))}`
      + `<div class="adx-plot" id="${PLOT.money}"></div></div>`
      + `<div class="card adx-chart">${chartHead('pct', 'ACoS &amp; TACoS', pctKey)}<div class="adx-plot" id="${PLOT.pct}"></div></div>`;
    RO_W = el.clientWidth;
    plot('money');
    plot('pct');
  }

  // The bar chart's "Overall", which is its legend too: the four figures over its own stretch (the ad ones over the periods
  // that have ad figures), each with its colour and the axis it is read on.
  function overallHtml(a) {
    return '<span class="adx-ovl">Overall</span>'
      + [['sales', 'bsales', 'Sales', 1], ['spend', 'spend', 'Ad spend', 1], ['acos', 'acos', 'ACoS', 0], ['tacos', 'tacos', 'TACOS', 0]].map(([k, c, t, sq]) => {
        const r = rowOf(k), v = r.ad ? (a.covered.length ? r.get(a.adTot) : null) : r.get(a.total), off = !!a.off[c];
        return `<button type="button" class="adx-lg${off ? ' off' : ''}" data-ch="bars" data-s="${c}" aria-pressed="${!off}" title="${sq ? 'Bars, read on the left ($) axis' : 'A line, read on the right (%) axis'} · click to show or hide">`
          + `<i${sq ? ' class="adx-sq"' : ''} style="--c:var(--adx-${c})"></i>${t} <b>${v == null ? '—' : tFmt(r, v)}</b><small>${sq ? 'left' : 'right'}</small></button>`;
      }).join('');
  }

  // One chart's plot, and the line under its title, from its own settings. The line charts take the complete periods that
  // have ad figures (the running one stays out); the bar chart takes every period.
  function plot(id) {
    const st = CH[id], el = $(PLOT[id]);
    if (!el) return;
    const a = seriesOf(st);
    const sub = document.querySelector(`[data-sub="${id}"]`);
    const many = st.n === 'custom' ? tRangeText(a.rg) + ` · by ${st.g}` : `Last ${st.n} ${st.g}${st.n === 1 ? '' : 's'}`;
    const cutAny = a.keys.some(k => a.part[k]);
    if (id === 'bars') {
      const last = a.keys[a.keys.length - 1];
      if (sub) sub.textContent = `${many} · ACoS and TACOS only where the ad figures are known${cutAny ? ` · a faint bar holds only the days in range` : last && !a.done[last] ? ` · the last ${st.g} is still running` : ''}`;
      const ov = $('tBarsOverall');
      if (ov) ov.innerHTML = overallHtml(a);
      barChart(el, a);
      return;
    }
    const keys = a.keys.filter(k => a.adKnown[k] && a.done[k] && !a.part[k]);
    const vals = k => keys.map(p => rowOf(k).get(a.agg[p]));
    const on = list => list.filter(s => !a.off[s.c]);
    const whole = `complete ${st.g}s with ad figures${cutAny ? ' (only whole ones inside the dates)' : ''}`;
    const first = keys.length ? a.short[keys[0]] : '', last = keys.length ? a.short[keys[keys.length - 1]] : '';
    const opt = { short: a.short, lab: a.lab, unit: st.g, anim: fresh('tCharts') };
    if (id === 'money') {
      if (sub) sub.textContent = `${many} · ${whole}`;
      lineChart(el, keys, on([
        { c: 'spend', t: 'Ad spend', v: vals('spend') },
        { c: 'adsales', t: 'Ad sales', v: vals('adSales'), area: true }]),
      Object.assign(opt, { money: true, label: `Ad spend and ad sales per ${st.g}, ${first} to ${last}` }));
      return;
    }
    if (sub) sub.textContent = `${many} · ${whole}`;
    lineChart(el, keys, on([
      { c: 'acos', t: 'ACoS', v: vals('acos') },
      { c: 'tacos', t: 'TACoS', v: vals('tacos') }]),
    Object.assign(opt, {
      refs: [{ v: BAND.high, t: `Over ${BAND.high}% · high ACoS`, cls: 'adx-be' }, { v: BAND.low, t: `Under ${BAND.low}% · room to grow`, cls: 'adx-lowr' },
        { v: TACOS_T, t: `TACoS ${TACOS_T}% goal`, cls: 'adx-tacr', mid: true }],
      band: { lo: BAND.low, hi: BAND.high }, label: `ACoS and TACoS per ${st.g}, ${first} to ${last}` }));
  }

  // A chart's period or stretch changed: that chart alone redraws.
  function replot(id) {
    try { plot(id); } catch (e) {
      if (id === 'bars') bars(false, e);
      else fail('tCharts', e);
    }
  }

  /* ---------- the bar chart: sales and ad spend per period, TACOS on its own axis ---------- */
  // $600K / $52.3K / $0K — the bar chart's axis and tip, rounded the way the eye reads money at a glance.
  const kShort = v => {
    const a = Math.abs(v);
    return '$' + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e5 || a === 0 ? Math.round(a / 1e3) + 'K' : (a / 1e3).toFixed(1) + 'K');
  };

  /**
   * Sales and ad spend as bars on a dollar axis (left), ACoS and TACOS as lines on a % axis (right), every period in view.
   * A period without ad figures gets no spend bar and no ACoS or TACOS point (a gap, never a zero); a dashed line marks where the
   * ad figures start; the biggest sales period is named when it stands well clear of the rest; the running period is
   * drawn faint. Hover snaps to a period and names its three figures.
   */
  function barChart(el, a) {
    const W = Math.round(el.clientWidth);
    if (W < MIN_W) return;                            // hidden, or not laid out yet — the ResizeObserver draws it once it has a width
    const keys = a.keys, n = keys.length;
    // --- the figures ---
    const sales = keys.map(k => a.agg[k][T_I.sales]);
    const spend = keys.map(k => (a.adKnown[k] ? a.agg[k][T_I.spend] : null));
    const tac = keys.map((k, i) => (a.adKnown[k] && sales[i] ? spend[i] / sales[i] * 100 : null));
    const adSales = keys.map(k => (a.adKnown[k] ? a.agg[k][T_I.adSales] : null));
    const acos = keys.map((k, i) => (a.adKnown[k] && adSales[i] ? spend[i] / adSales[i] * 100 : null));
    // What the legend has switched off is left out of the drawing and of the scales (the tip still names all four).
    const off = a.off || {}, cut = a.part || {};
    const seeS = !off.bsales, seeP = !off.spend;
    const vis = (on, list) => (on ? list.filter(v => v != null) : []);
    // --- the scales: both axes in four steps, so they share the grid ---
    const H = W < 520 ? 250 : 300, L = W < 520 ? 58 : 70, R = W < 520 ? 44 : 56, T = 30, B = 30;
    const topM = niceTop(Math.max(1, ...vis(seeS, sales), ...vis(seeP, spend)) * 1.04);
    const topP = niceTop(Math.max(4, ...vis(!off.tacos, tac), ...vis(!off.acos, acos)) * 1.15);
    const slot = (W - L - R) / n;
    const x = i => L + (i + 0.5) * slot;
    const yM = v => T + (1 - v / topM) * (H - T - B);
    const yP = v => T + (1 - v / topP) * (H - T - B);
    const bw = Math.max(3, Math.min(16, slot * 0.3));
    const running = n && !a.done[keys[n - 1]] ? n - 1 : -1;
    let g = '';
    // --- grid, the two axes and their titles ---
    for (let i = 0; i <= 4; i++) {
      const yy = yM(topM * i / 4);
      g += `<line class="adx-gl" x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`
        + `<text x="${L - 8}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${kShort(topM * i / 4)}</text>`
        + `<text class="adx-pct" x="${W - R + 8}" y="${(yy + 3.5).toFixed(1)}">${Math.round(topP * i / 4)}%</text>`;
    }
    const midY = (T + H - B) / 2;
    g += `<text class="adx-axt" transform="translate(13 ${midY.toFixed(1)}) rotate(-90)" text-anchor="middle">Sales &amp; ad spend</text>`
      + `<text class="adx-axt" transform="translate(${W - 8} ${midY.toFixed(1)}) rotate(90)" text-anchor="middle">ACoS &amp; TACOS</text>`;
    // --- where the ad figures start (Amazon keeps about 95 days of them) ---
    const first = keys.findIndex(k => a.adKnown[k]);
    if (first > 0) {
      const xx = L + first * slot;
      g += `<line class="adx-start" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${T - 14}" y2="${H - B}"/>`
        + `<text class="adx-note-t" x="${(xx - 6).toFixed(1)}" y="${T - 4}" text-anchor="end">Ad figures start</text>`;
    }
    // --- the bars (growing in, one after another, the first time the chart rises into view) ---
    const anim = fresh('tBars');
    keys.forEach((k, i) => {
      const run = (i === running || cut[k] ? ' adx-run' : '') + (anim ? ` adx-grow" style="--d:${i * 9}ms` : '');
      if (seeS) g += `<rect class="adx-bs${run}" x="${(x(i) - bw - 1).toFixed(1)}" y="${yM(sales[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - B - yM(sales[i])).toFixed(1)}" rx="2"/>`;
      if (seeP && spend[i] != null) {
        g += `<rect class="adx-bp${run}" x="${(x(i) + 1).toFixed(1)}" y="${yM(spend[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - B - yM(spend[i])).toFixed(1)}" rx="2"/>`;
      }
    });
    // --- the spike: the biggest sales period, named when it is a third above the middle of the rest ---
    const done = sales.filter((v, i) => i !== running).slice().sort((p, q) => p - q);
    const mid = done.length ? done[Math.floor(done.length / 2)] : 0;
    const top = sales.reduce((b, v, i) => (i !== running && v > sales[b] ? i : b), running === 0 ? Math.min(1, n - 1) : 0);
    if (seeS && mid > 0 && sales[top] > mid * 1.35) {
      const right = x(top) + bw + 8 < W - R - 70;
      g += `<text class="adx-note-t" x="${(right ? x(top) + 8 : x(top) - bw - 8).toFixed(1)}" y="${(yM(sales[top]) + 12).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">Spike ${esc(a.g)}</text>`;
    }
    // --- the two % lines: a run per stretch of known periods and a dot on each; the newest of each named ---
    const pctLine = (vals, c) => {
      const runs = [];
      let run = [];
      vals.forEach((v, i) => {
        if (v == null) {
          if (run.length) runs.push(run);
          run = [];
        } else run.push([x(i), yP(v)]);
      });
      if (run.length) runs.push(run);
      runs.forEach(p => { g += `<path class="adx-tl${anim ? ' adx-draw' : ''}"${anim ? ' pathLength="1"' : ''} style="--c:var(--adx-${c})" d="M${p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' L')}"/>`; });
      vals.forEach((v, i) => { if (v != null) g += `<circle class="adx-td" style="--c:var(--adx-${c})" cx="${x(i).toFixed(1)}" cy="${yP(v).toFixed(1)}" r="3"/>`; });
      for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return { i, v: vals[i], c };
      return null;
    };
    const ends = [off.acos ? null : pctLine(acos, 'acos'), off.tacos ? null : pctLine(tac, 'tacos')].filter(Boolean);
    // Each named above its dot; when the two would touch, the lower one goes under its own.
    ends.forEach(e => { e.y = yP(e.v) - 9; });
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
      const lo = ends[0].v < ends[1].v ? ends[0] : ends[1];
      lo.y = yP(lo.v) + 17;
    }
    ends.forEach(e => {
      g += `<text class="adx-tv" style="--c:var(--adx-${e.c})" x="${x(e.i).toFixed(1)}" y="${e.y.toFixed(1)}" text-anchor="middle">${Math.round(e.v)}%</text>`;
    });
    // --- x labels, never closer than ~84px, always the first one ---
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 84))));
    keys.forEach((k, i) => {
      if (i % every) return;
      g += `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(a.lab[k])}</text>`;
    });
    // --- the hover layer: a band on the period, one tip with its three figures ---
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Sales and ad spend per ${a.g} with ACoS and TACOS, ${n ? a.lab[keys[0]] : ''} to ${n ? a.lab[keys[n - 1]] : ''}`)}">`
      + `<rect class="adx-band hide" y="${T}" height="${H - T - B}" width="${Math.max(0, slot).toFixed(1)}"/>${g}`
      + `<rect class="adx-hit" x="${L}" y="0" width="${Math.max(0, W - L - R)}" height="${H}"/></svg><div class="adx-tip hide"></div>`;
    const svg = el.firstChild, tip = el.lastChild, band = svg.querySelector('.adx-band');
    svg.addEventListener('pointermove', ev => {
      const box = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - box.left) * W / box.width - L) / slot)));
      band.setAttribute('x', (L + i * slot).toFixed(1));
      band.classList.remove('hide');
      tip.innerHTML = `<div class="adx-tip-h">${esc(a.lab[keys[i]])}${i === running && !cut[keys[i]] ? ' · so far' : ''}</div>`
        + `<div><i class="adx-sq" style="--c:var(--adx-bsales)"></i>Sales: <b>${kShort(sales[i])}</b></div>`
        + `<div><i class="adx-sq" style="--c:var(--adx-spend)"></i>Ad spend: <b>${spend[i] == null ? 'no ad figures' : kShort(spend[i])}</b></div>`
        + (acos[i] == null ? '' : `<div><i style="--c:var(--adx-acos)"></i>ACoS: <b>${acos[i].toFixed(1)}%</b></div>`)
        + (tac[i] == null ? '' : `<div><i style="--c:var(--adx-tacos)"></i>TACOS: <b>${tac[i].toFixed(1)}%</b></div>`);
      tip.classList.remove('hide');
      const at = x(i) * box.width / W;
      tip.style.left = Math.round(at > box.width / 2 ? at - tip.offsetWidth - 14 : at + 14) + 'px';
    });
    svg.addEventListener('pointerleave', () => {
      band.classList.add('hide');
      tip.classList.add('hide');
    });
  }

  // The bar chart's card: title, its own line and controls, the overall figures, the legend in the order the eye meets the
  // bars, the plot.
  function drawBars() {
    $('tBars').innerHTML = chartHead('bars', 'Sales, ad spend, ACoS &amp; TACOS', '', '<div class="adx-overall" id="tBarsOverall"></div>')
      + `<div class="adx-plot" id="${PLOT.bars}"></div>`;
    plot('bars');
  }

  // Redraw the plots when their width changes (window resized, pane shown again) — at most once a frame.
  function watchWidth() {
    if (RO || typeof ResizeObserver !== 'function') return;
    let queued = false;
    RO = new ResizeObserver(() => {
      const w = $('tCharts').clientWidth;
      if (!w || Math.abs(w - RO_W) < 4 || queued || !LAST) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        RO_W = $('tCharts').clientWidth;
        replot('money');
        replot('pct');
        if (!$('tBars').classList.contains('hide')) replot('bars');
      });
    });
    RO.observe($('tCharts'));
  }

  /* ---------- Campaign performance ---------- */
  // Once per session: the ad-group cache (unless Search Terms already holds it), then the unit costs and the weekly sales
  // the break-even needs — those two only for an account the database lets read them (audit/costs is gated on Profit).
  async function campLoad() {
    try {
      // The ad-group cache, the unit costs and the weekly sales all at once (they used to come one after another).
      const jobs = [];
      if (can('profit') || can('audit')) jobs.push(loadCosts().catch(() => { /* the break-even stays unknown */ }));
      if ((can('weekly') || can('profit') || can('audit')) && !WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) {
        jobs.push(loadWeekly().catch(() => { /* the price stays unknown */ }));
      }
      if (ST.loaded) {
        CAMP.ag = ST.ag || {};
        CAMP.at = ST.at || '';
      } else {
        jobs.push(baCall({ cache: 'adGroup' }).then(r => {
          const d = (r && r.data) || {};
          CAMP.ag = d.d || {};
          CAMP.at = d.at || '';
        }));
      }
      await Promise.all(jobs);
      CAMP.st = 'ready';
    } catch (e) {
      CAMP.st = 'failed';
      CAMP.err = (e && e.message) || String(e);
    }
    CAMP.ver++;
    try { drawCamp(); } catch (e) { fail('tCamp', e); }
    try { if (LAST && LAST.keys.length) drawCharts(); } catch (e) { fail('tCharts', e); }   // the break-even line, now known
    if (LAST) paintBoxes(LAST);                                                                  // and the ACOS box's note
    try { ADSH.draw(); } catch (e) { fail('tHealth', e); }                                       // the checks can run now
  }

  // The campaigns of the brands in view, rolled up from the ad-group rows: ACoS, break-even, target, and what the ad sales
  // leave after the ads (before overhead) — Σ ad sales × the product's break-even margin, less the spend, costed products only.
  function campRows() {
    const key = brandsInView().join(',') + '|' + CAMP.ver + '|' + paceFresh();
    if (CAMP.rowsKey === key) return CAMP.rows;
    const by = {};
    brandsInView().forEach(b => {
      const pack = CAMP.ag[b] || {};
      const names = pack.names || {};
      (pack.rows || []).forEach(x => {
        const id = b + '|' + x.cid;
        const c = by[id] || (by[id] = { brand: b, cid: x.cid, name: names[x.cid] || '', sp: 0, s: 0, o: 0, cl: 0, cs: 0, csp: 0, pre: 0, preT: 0,
          asins: new Set(), costed: new Set(), st: new Set(), prods: new Map() });
        c.sp += x.sp || 0;
        c.s += x.s || 0;
        c.o += x.o || 0;
        c.cl += x.c || 0;
        if (x.st) c.st.add(x.st);
        // each product it advertises, added up over its ad groups (for the row's own list when it is opened)
        if (x.sku || x.a) {
          const pk = x.sku || x.a;
          const p = c.prods.get(pk) || { sku: x.sku || '', a: x.a || '', sp: 0, s: 0, o: 0, cl: 0, st: new Set() };
          p.sp += x.sp || 0;
          p.s += x.s || 0;
          p.o += x.o || 0;
          p.cl += x.c || 0;
          if (x.st) p.st.add(x.st);
          c.prods.set(pk, p);
        }
        if (!x.a) return;
        c.asins.add(x.a);
        // The break-even of the ASIN at its own recent price — the very figure Search Terms shows for it, and the same before
        // overhead and salary.
        const ln = lines(x.a);
        if (ln.tgt == null) return;
        c.costed.add(x.a);
        c.cs += x.s || 0;
        c.csp += x.sp || 0;
        c.pre += (x.s || 0) * ln.be / 100;    // what the ad sales leave before the ads, overhead and salary
        c.preT += (x.s || 0) * ln.tgt / 100;  // … and after overhead and salary (Search Terms' break-even)
      });
    });
    CAMP.rowsKey = key;
    CAMP.rows = Object.values(by).filter(c => c.sp > 0).map(c => {
      const be = c.cs > 0 ? c.pre / c.cs * 100 : null;
      return { brand: c.brand, cid: c.cid, name: c.name, sp: c.sp, s: c.s, o: c.o, cl: c.cl, cs: c.cs, pre: c.pre, preT: c.preT, st: c.st,
        prods: [...c.prods.values()].sort((p, q) => q.sp - p.sp),
        acos: c.s > 0 ? c.sp / c.s * 100 : null, be, tgt: be != null ? c.preT / c.cs * 100 : null,
        invest: INVEST.test(c.name), profit: c.costed.size ? c.pre - c.csp : null, nAsin: c.asins.size, nCost: c.costed.size };
    }).sort((p, q) => q.sp - p.sp);
    return CAMP.rows;
  }

  // The brands in view that spent on ads in the last 30 days with ad figures (the store the boxes read) and have no campaign
  // rows at all — each with that spend.
  function missingBrands() {
    const to = TREND.adTo;
    if (CAMP.st !== 'ready' || !to) return [];
    const from = sdShift(to, -29);
    return brandsInView().map(b => ({ b, sp: trendSum([b], from, to).spend }))
      .filter(x => x.sp >= 100 && !((CAMP.ag[x.b] || {}).rows || []).some(r => r.sp > 0));
  }

  // The verdict of one campaign, by the ACoS range alone: { k: its class (adx-low / adx-good / adx-crit / adx-inv / adx-none),
  // t: its words, tip: what it means, in one sentence }.
  function verdict(r) {
    if (!(r.s > 0)) return { k: r.o ? 'adx-none' : 'adx-crit', t: 'Spend, no sales', tip: 'It spent in the 30 days and Amazon credits it with no sale.' };
    if (r.o < MIN_ORDERS) return { k: 'adx-none', t: 'Too few orders', tip: `Fewer than ${MIN_ORDERS} orders in the 30 days — too early to judge.` };
    if (r.invest && r.acos > BAND.high) return { k: 'adx-inv', t: 'Investing', tip: 'A launch, ranking or seasonal campaign by its name — it may be meant to cost more for a while.' };
    if (r.acos > BAND.high) return { k: 'adx-crit', t: 'High ACoS', tip: `ACoS over ${BAND.high}% — lowering bids a little may help.` };
    if (r.acos >= BAND.low) return { k: 'adx-good', t: 'In range', tip: `ACoS ${BAND.low}–${BAND.high}%, the good range.` };
    return { k: 'adx-low', t: 'Room to grow', tip: `ACoS under ${BAND.low}% — a small bid increase may bring more sales, stock allowing.` };
  }
  // Is the campaign running? From the one-letter ad status of its rows (CP_STATE): any ad live → Active.
  function runTag(st) {
    const all = [...st];
    if (!all.length || all.every(x => x === '?')) return '';
    if (st.has('E')) return '<span class="ui-badge is-ok">Active</span>';
    if (all.every(x => x === 'A')) return '<span class="ui-badge">Archived</span>';
    return '<span class="ui-badge" title="No ad in this campaign is running today">Paused</span>';
  }

  // Business Reports' sessions (the nightly 'sessions' cache, PPC & Organic's): once per visit, added up per brand per week when
  // they arrive. st = idle / loading / ready / failed; wk = { brand: { week: sessions } }.
  const SESS = { st: 'idle', at: '', wk: {} };
  const sessRight = () => can('weekly') || can('ppcn');
  async function sessLoad() {
    try {
      const r = await baCall({ cache: 'sessions' });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'no sessions');
      const d = (r.data && r.data.d) || {};
      SESS.at = (r.data && r.data.at) || '';
      Object.keys(d).forEach(b => {
        const into = SESS.wk[b] = {};
        Object.values(d[b] || {}).forEach(byWeek => Object.entries(byWeek || {}).forEach(([w, v]) => {
          into[w] = (into[w] || 0) + (Number(Array.isArray(v) ? v[0] : v) || 0);
        }));
      });
      SESS.st = 'ready';
    } catch (e) { SESS.st = 'failed'; }
    try { if (LAST) paintBoxes(LAST); } catch (e) { fail('tBoxes', e); }
  }

  // Start loading the campaign figures (and Recommendation's), and the sessions, if nothing has asked yet. The requests go
  // out at once; the page does not wait for them.
  function startLoad() {
    if (CAMP.st === 'idle' && can('st')) {
      CAMP.st = 'loading';
      campLoad();
    }
    if (SESS.st === 'idle' && sessRight()) {
      SESS.st = 'loading';
      sessLoad();
    }
    try { ADSH.warmUp(); } catch (e) { /* it starts when it draws instead */ }
  }
  // A head start: the figures start loading as soon as the pointer is on "Ad Console" in the menu, before the click.
  try {
    const tab = $('tabTrends');
    const early = () => { try { if (ME && ME.tabs) startLoad(); } catch (e) { /* not signed in yet */ } };
    if (tab) ['pointerenter', 'focus', 'touchstart'].forEach(ev => tab.addEventListener(ev, early, { passive: true }));
  } catch (e) { /* no menu item: it loads on opening, as before */ }

  /* ---------- stock, from Recommendation's copy of Listing Health's FBA stock ---------- */
  // { st, days } of one SKU (days at its product's pace over the last four finished weeks), or null when not known.
  const stockOf = (b, sku, a) => {
    try { return ADSH.stockInfo(b, sku, a); } catch (e) { return null; }
  };
  // The light tint a stock level gets: out of stock, under 7 days, under 15 days (none above, or when not known).
  const tintOf = s => {
    try { return ADSH.tint(s); } catch (e) { return ''; }
  };
  // The tightest stock among a campaign's products that sold in the 30 days (all its products when none sold), with the
  // SKU and how many were read; null when none is known.
  function campStock(r) {
    const sold = r.prods.filter(p => p.o > 0 && p.sku);
    const list = (sold.length ? sold : r.prods.filter(p => p.sku)).map(p => {
      const s = stockOf(r.brand, p.sku, p.a);
      return s ? Object.assign({ sku: p.sku }, s) : null;
    }).filter(Boolean);
    if (!list.length) return null;
    const rank = s => (s.st <= 0 ? -1 : s.days == null ? 1e9 : s.days);
    list.sort((p, q) => rank(p) - rank(q));
    return Object.assign({ n: list.length }, list[0]);
  }
  // A stock level in words: "Out of stock", "6 days of stock", "420 in stock".
  const stockWords = s => (s.st <= 0 ? 'Out of stock' : s.days != null ? `${Math.max(1, Math.floor(s.days))} ${Math.floor(s.days) <= 1 ? 'day' : 'days'} of stock` : `${s.st.toLocaleString('en-US')} in stock`);
  // A campaign's stock chip, tinted by how soon it runs out.
  function stockChip(r) {
    const s = campStock(r);
    if (!s) return '';
    const tip = `FBA stock of ${s.sku}: ${s.st.toLocaleString('en-US')} units${s.days != null ? `, about ${Math.floor(s.days)} days at its pace over the last four finished weeks` : ''}`
      + (s.n > 1 ? ` — the tightest of the ${s.n} products it sells` : '');
    return `<span class="adx-stk ${tintOf(s)}" title="${esc(tip)}">${esc(stockWords(s))}</span>`;
  }
  // An opened campaign: its products, each with its spend, sales, orders, ACoS, ad status and stock — tinted by stock.
  function campDetail(r) {
    const head = ['SKU', 'ASIN', 'Ad', 'Spend', 'Ad sales', 'Orders', 'ACoS', 'FBA stock', 'Days left'];
    const num = new Set([3, 4, 5, 6, 7, 8]);
    const stTxt = st => (st.has('E') ? 'Running' : st.size && [...st].every(x => x === 'A') ? 'Archived' : st.size && ![...st].every(x => x === '?') ? 'Paused' : '—');
    const rows = r.prods.slice(0, 60).map(p => {
      const s = p.sku ? stockOf(r.brand, p.sku, p.a) : null, t = s ? tintOf(s) : '';
      const cells = [esc(p.sku || '—'), esc(p.a || '—'), stTxt(p.st), dollars(p.sp), dollars(p.s), Math.round(p.o).toLocaleString('en-US'),
        p.s > 0 ? (p.sp / p.s * 100).toFixed(1) + '%' : '—', s ? s.st.toLocaleString('en-US') : '—', s && s.st <= 0 ? '0' : s && s.days != null ? String(Math.max(1, Math.floor(s.days))) : '—'];
      return `<tr${t ? ` class="${t}"` : ''}>` + cells.map((v, j) => `<td${num.has(j) ? ' class="num"' : ''}>${v}</td>`).join('') + '</tr>';
    }).join('');
    const more = r.prods.length > 60 ? `<div class="adh-evmore">and ${r.prods.length - 60} more products</div>` : '';
    return `<div class="adx-cdet"><div class="adh-ev"><table class="adh-t"><thead><tr>${head.map((h, j) => `<th${num.has(j) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>`
      + `<tbody>${rows}</tbody></table>${more}</div>${STOCK_KEY}</div>`;
  }
  // The key to the stock tints, under a table that uses them.
  const STOCK_KEY = '<div class="adh-tkey"><span><i class="adh-k0"></i>Out of stock</span><span><i class="adh-k7"></i>Under 7 days</span>'
    + '<span><i class="adh-k15"></i>Under 15 days</span><span class="adh-tkn">days of FBA stock at each product\'s pace over the last four finished weeks</span></div>';
  // Narrow Campaign performance to some campaigns (from Recommendation), scroll to it and light them up; one campaign opens.
  function focus(keys, label) {
    CAMP.only = { keys: new Set(keys), t: label || 'Recommendation' };
    if (keys.length === 1) CAMP.open.add(keys[0]);
    CAMP.sig = '';
    try { drawCamp(); } catch (e) {
      fail('tCamp', e);
      return;
    }
    const el = $('tCamp');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.querySelectorAll('.adx-crow').forEach(r => {
      if (!CAMP.only.keys.has(r.dataset.k)) return;
      r.classList.remove('adx-flash');
      void r.offsetWidth;
      r.classList.add('adx-flash');
    });
  }
  // One set of listeners on Campaign performance: a row opens and closes, the filter clears, Show all.
  function wireCamp() {
    const el = $('tCamp');
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    const redraw = () => {
      CAMP.sig = '';
      try { drawCamp(); } catch (e) { fail('tCamp', e); }
    };
    const toggle = row => {
      const k = row.dataset.k;
      if (CAMP.open.has(k)) CAMP.open.delete(k);
      else CAMP.open.add(k);
      redraw();
    };
    el.addEventListener('click', e => {
      if (e.target.closest('.adx-unfilter')) {
        CAMP.only = null;
        redraw();
        return;
      }
      if (e.target.closest('.adx-more')) {
        CAMP.all = !CAMP.all;
        redraw();
        return;
      }
      const row = e.target.closest('.adx-crow');
      if (row && !e.target.closest('a, button, .adx-i')) toggle(row);
    });
    el.addEventListener('keydown', e => {
      const row = e.target.closest('.adx-crow');
      if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        toggle(row);
      }
    });
  }
  // Redraw Campaign performance (the stock has arrived).
  function campRedraw() {
    CAMP.sig = '';
    try { if (CAMP.st === 'ready') drawCamp(); } catch (e) { fail('tCamp', e); }
  }

  // Campaign performance: one row per campaign with spend in the 30 days, biggest spend first; 8, then "Show all".
  function drawCamp() {
    const el = $('tCamp');
    // The ad-group figures are Search Terms' to show: an account without that tab does not get them here either.
    if (!can('st')) {
      show('tCamp', false);
      return;
    }
    show('tCamp', true);
    wireCamp();
    // Nothing it shows has changed (another period, the same brands): leave it as it is.
    const sig = CAMP.st === 'ready' ? campRows() && [CAMP.rowsKey, CAMP.all, CAMP.only ? CAMP.only.t + [...CAMP.only.keys].join(',') : '',
      [...CAMP.open].join(','), (() => { try { return ADSH.stockReady(); } catch (e) { return 0; } })()].join('|') : CAMP.st + '|' + CAMP.err;
    if (sig === CAMP.sig && el.innerHTML) return;
    CAMP.sig = sig;
    CAMP.pbe = null;
    const headOf = sub => '<div class="adx-camp-head"><div><h3 class="ui-card-title">Campaign performance</h3>'
      + `<div class="ui-note">${sub}</div></div>`
      + '<a class="adx-link" href="https://advertising.amazon.com/" target="_blank" rel="noopener noreferrer">Open in Amazon Ads ↗</a></div>';
    const head = headOf(`Last 30 days · Sponsored Products · each campaign's ACoS against the ${BAND.low}–${BAND.high}% range · biggest spend first`);
    if (CAMP.st === 'idle' || CAMP.st === 'loading') {
      el.innerHTML = head + '<div class="adx-cskel"><i></i><i></i><i></i><i></i></div>';
      el.classList.add('adx-camp-wait');
      return;
    }
    if (CAMP.st === 'failed') {
      el.innerHTML = head + `<div class="ui-error">Could not load the campaign figures — ${esc(CAMP.err)}. Reload the page to try again.</div>`;
      return;
    }
    const rows = campRows();
    // A brand in view that spent on ads but is not in the campaign figures at all: its report did not arrive last night. Said
    // by name, never "no figures yet", which waits for a morning that does not bring them.
    const gone = missingBrands(), who = gone.map(x => esc(BRAND_NAME[x.b] || x.b)).join(' and ');
    const goneSp = dollars(gone.reduce((t, x) => t + x.sp, 0));
    if (!rows.length) {
      el.innerHTML = head + (gone.length
        ? `<div class="adx-cmiss"><b>${who}'s campaign report did not arrive last night.</b> Overview shows ${goneSp} of ${who} ad spend in the last 30 days with ad figures, and none of it is in the campaign figures. It has to come in through the nightly run — Recommendation → Data shows exactly what is missing.</div>`
        : '<div class="ui-empty">No campaign figures yet. The nightly run keeps them, so they appear here the morning after.</div>');
      return;
    }
    const goneNote = gone.length
      ? `<div class="adx-cmiss"><b>${who} ${gone.length > 1 ? 'are' : 'is'} not in last night's campaign figures</b> — ${goneSp} of ad spend in the last 30 days with ad figures is missing, so only ${esc([...new Set(rows.map(r => BRAND_NAME[r.brand] || r.brand))].join(' and '))}'s campaigns are listed.</div>`
      : '';
    // --- the break-even over everything in view, for the ACoS chart ---
    const s = rows.reduce((t, r) => t + r.s, 0), cs = rows.reduce((t, r) => t + r.cs, 0), pre = rows.reduce((t, r) => t + r.pre, 0);
    const preT = rows.reduce((t, r) => t + r.preT, 0);
    if (cs > 0 && cs >= s * BE_MIN_COVER && pre > 0) CAMP.pbe = { be: pre / cs * 100, tgt: preT / cs * 100 };
    // --- the rows ---
    const anyCost = rows.some(r => r.nCost > 0);
    // Narrowed by Recommendation: those campaigns only, all of them.
    const pool = CAMP.only ? rows.filter(r => CAMP.only.keys.has(r.brand + '|' + r.cid)) : rows;
    const list = CAMP.only || CAMP.all ? pool : pool.slice(0, CAMP_ROWS);
    const body = list.map(r => {
      const v = verdict(r);
      // The track is tinted in the range's three zones: room to grow, the good range, high.
      const zt = BAND.low, zb = BAND.high;
      const marks = r.be != null && r.be > 0
        ? `<b class="adx-t" style="left:${Math.max(0, Math.min(100, r.tgt)).toFixed(1)}%" title="Target ${r.tgt.toFixed(1)}%"></b>`
          + `<b class="adx-be" style="left:${Math.min(100, r.be).toFixed(1)}%" title="Break-even ${r.be.toFixed(1)}%"></b>` : '';
      const keys = `<b class="${v.k}">ACoS ${r.acos == null ? '—' : r.acos.toFixed(1) + '%'}</b>`
        + (r.be != null && r.be > 0 ? `<span class="adx-t">Target ${r.tgt.toFixed(1)}%</span><span class="adx-be">Break-even ${r.be.toFixed(1)}%</span>` : '')
        + `<span>${dollars(r.sp)} spent · ${dollars(r.s)} ad sales · ${Math.round(r.o).toLocaleString('en-US')} orders</span>`
        + (anyCost ? `<span>costs for ${r.nCost} of ${r.nAsin} product${r.nAsin === 1 ? '' : 's'}</span>` : '');
      const pc = r.profit == null ? '<b class="ui-dim">—</b><small>needs a unit cost</small>'
        : `<b${r.profit < 0 ? ' class="ui-neg"' : ''}>${dollars(r.profit)}</b><small title="Ad sales × the products' break-even margin, less the spend — before overhead and salary. Products with a unit cost only.">left after ads</small>`;
      const profit = !anyCost ? '' : `<div class="adx-cprofit">${pc}</div>`;
      const id = r.brand + '|' + r.cid, open = CAMP.open.has(id);
      return `<div class="adx-crow${open ? ' is-open' : ''}" data-k="${esc(id)}" role="button" tabindex="0" aria-expanded="${open}" title="${open ? 'Close' : 'Open'} its products and their stock">`
        + `<div class="adx-cname"><span class="ui-name" title="${esc(r.name || r.cid)}">${esc(r.name || r.cid)}</span>`
        + `<div class="adx-ctags">${runTag(r.st)}${v.t ? `<span class="adx-st ${v.k}" title="${esc(v.tip || '')}">${STATUS[v.k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${STATUS[v.k]}</svg>` : ''}${esc(v.t)}</span>` : ''}`
        + `${stockChip(r)}<span>${esc(BRAND_NAME[r.brand] || r.brand)}</span><span class="adx-copen">${r.prods.length} ${r.prods.length === 1 ? 'product' : 'products'} ${open ? '▴' : '▾'}</span></div></div>`
        + `<div class="adx-cbar"><div class="adx-track" style="--zt:${zt.toFixed(1)}%;--zb:${zb.toFixed(1)}%"><i class="${v.k}" style="width:${Math.min(100, r.acos || 0).toFixed(1)}%"></i>${marks}</div>`
        + `<div class="adx-ckeys">${keys}</div></div>${profit}</div>${open ? campDetail(r) : ''}`;
    }).join('');
    // --- the foot: what the figures are, and the button ---
    const why = `each campaign is coloured by its ACoS: under ${BAND.low}% blue (room to grow), ${BAND.low}–${BAND.high}% green (the good range), over ${BAND.high}% red (high) · fewer than ${MIN_ORDERS} orders is too early to judge`
      + (anyCost ? ' · the ticks mark each campaign\'s target and break-even (Profit &amp; Margin)' : '');
    // The key to the colours, under the title.
    const key = (c, t) => `<span><i class="${c}"></i>${t}</span>`;
    const legend = '<div class="adx-clegend">'
      + key('adx-low', `Under ${BAND.low}% · room to grow`) + key('adx-good', `${BAND.low}–${BAND.high}% · in range`) + key('adx-crit', `Over ${BAND.high}% · high`)
      + key('adx-inv', 'Investing') + key('adx-none', 'Too few orders') + '</div>';
    const stAt = brandsInView().map(b => (CAMP.ag[b] || {}).stAt).filter(Boolean)[0];
    const more = !CAMP.only && rows.length > CAMP_ROWS ? `<button class="ghost adx-more" type="button">${CAMP.all ? 'Show fewer' : `Show all ${rows.length}`}</button>` : '';
    const filt = CAMP.only ? `<div class="adx-cfilter"><span>Showing the ${pool.length} ${pool.length === 1 ? 'campaign' : 'campaigns'} from <b>${esc(CAMP.only.t)}</b> · click a row for its products and stock</span>`
      + '<button class="ghost adx-unfilter" type="button">Show every campaign ✕</button></div>' : '';
    el.classList.toggle('adx-acosonly', !anyCost);
    el.classList.remove('adx-camp-wait');
    el.innerHTML = head + legend + filt + goneNote + body + `<div class="adx-cfoot"><span>${list.length} of ${rows.length} campaigns with spend${CAMP.at ? ` · built ${esc(CAMP.at)}` : ''}`
      + `${stAt ? ` · ad status read ${esc(stAt)}` : ''} · ${why} · advice only: nothing here changes a bid at Amazon</span>${more}</div>`;
  }

  /* ---------- the one entry point ---------- */
  // Called by renderTrends with what it worked out. Each block draws on its own; a failure hides that block only.
  // The boxes, and the old card only while they are not showing.
  function paintBoxes(a) {
    let boxes = false;
    try {
      if (a.keys.length) {
        drawBoxes(a);
        boxes = true;
      }
    } catch (e) { fail('tBoxes', e); }
    show('tBoxes', boxes);
    $('tKpis').classList.toggle('hide', boxes);
  }

  function draw(a) {
    LAST = a;
    try {
      fxSetup();
      wireUi();
      const note = $('tPerfNote');
      if (note) note.textContent = `All ${T_ROWS.length} measures, ${T_GRAN} by ${T_GRAN} · ${a.keys.length} ${T_GRAN}${a.keys.length === 1 ? '' : 's'} · opens on the newest`;
    } catch (e) { console.warn('[ads-charts]', e); }
    // --- Campaign performance first: it works out the break-even the ACOS box and the ACoS chart name ---
    try {
      startLoad();
      drawCamp();
    } catch (e) { fail('tCamp', e); }
    // --- the boxes ---
    paintBoxes(a);
    // --- Recommendation (ads/ads-health.js): ACoS and stock suggestions on the same 30 days, ranked ---
    try { ADSH.draw(); } catch (e) { fail('tHealth', e); }
    // --- the two charts ---
    try {
      show('tCharts', a.keys.length > 0);
      if (a.keys.length) {
        drawCharts();
        watchWidth();
      }
    } catch (e) { fail('tCharts', e); }
    // --- the bar chart, in place of the old one (which stays in the page, hidden, and comes back if this fails) ---
    try {
      if (a.keys.length) {
        show('tBars', true);
        drawBars();
        bars(true);
      } else bars(false);
    } catch (e) { bars(false, e); }
    // --- the table opens on the newest period ---
    try {
      const wrap = $('tTable').closest('.xlwrap');
      if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    } catch (e) { /* it stays where it was */ }
  }

  // All sales, ad spend and ad sales of some brands from one day to another (both included), from the store the boxes read.
  function trendSum(brands, from, to) {
    let sales = 0, spend = 0, adSales = 0;
    brands.forEach(b => Object.entries(TREND.d[b] || {}).forEach(([day, v]) => {
      if (day < from || day > to) return;
      sales += v[T_I.sales] || 0;
      spend += v[T_I.spend] || 0;
      adSales += v[T_I.adSales] || 0;
    }));
    return { sales, spend, adSales };
  }

  // What Recommendation (ads/ads-health.js) reads: the campaign figures' state and the very rows Campaign performance draws,
  // and the first and last day with ad figures in the store the boxes read.
  function state() {
    const rows = CAMP.st === 'ready' ? campRows() : [];
    // The last 28 days with ad figures, straight from the store the boxes read: TACOS for the whole account.
    let t28 = null;
    try {
      if (TREND.adTo) {
        const to = TREND.adTo, from = [sdShift(to, -27), TREND.adFrom || ''].sort()[1];
        t28 = Object.assign({ from, to }, trendSum(brandsInView(), from, to));
      }
    } catch (e) { t28 = null; }
    return { st: CAMP.st, err: CAMP.err, ag: CAMP.ag, at: CAMP.at, brands: brandsInView(), rows, t28, anyCost: rows.some(r => r.nCost > 0),
      ver: CAMP.ver, key: CAMP.rowsKey, band: BAND, ad: { from: TREND.adFrom || '', to: TREND.adTo || '' } };
  }

  return { draw, state, lines, paceFresh, trendSum, focus, campRedraw };
})();
