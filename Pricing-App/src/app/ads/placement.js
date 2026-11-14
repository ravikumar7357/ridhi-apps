/* ================= ADS · PLACEMENT: the Placement screen, and the Ad Console screen =================
 * Screens: two. Placement (tab 'plc', pane panePlc; core/nav.js calls ensurePlc): the brand picker (plcBrand), the
 * day / week / month control (plcGranSeg), Export (plcCsv), the message line (plcMsg), the spend-per-placement
 * strip (plcKpis), the stacked-bar chart (plcChart), the table (plcTable) and the worst offenders (plcWorst).
 * Ad Console (tab 'trends', pane paneTrends; nav.js calls ensureTrends): brand (tBrand), Day / Week / Month /
 * Quarter (tGranDay…), how much history (tSpan), Refresh / Stop (tRefresh), Export (tExport), the message line
 * (tMsg), the card (tKpis), the chart (tChart) and the metrics × periods table (tTable). The Ad Console's store,
 * TREND, and its nightly fill live in ads/account-trends.js.
 * Does — Placement: PLC is the nightly placement cache (baCall cache: 'placement'); plcAgg rolls it up per
 * placement, per day / week / month bucket and per worst campaign × placement, with Amazon's raw placement names
 * mapped to ours (PLC_LABEL); renderPlc draws the strip, the chart (plcChartSvg), the table and the offenders; the
 * plcCsv handler exports both tables. Ad Console: trendsRefresh rescans the Orders workbooks for daily sales and
 * asks Amazon for the ad reports in 31-day slices (ask now, collect later — tCollect downloads the finished ones,
 * in the same run or on a later visit); tSeries rolls the days into the chosen period (tPeriodKey) and marks which
 * periods have complete ad figures; renderTrends draws the card, the chart (tChart) and the table (T_ROWS, tFmt);
 * the tExport handler writes the same table as a CSV.
 * Main functions: plcMsg, ensurePlc, plcBucket, plcAgg, renderPlc, plcChartSvg, ensureTrends, tCell, tCall,
 * trendsRefresh, tCollect, tPeriodKey, tPeriodLabel, tSeries, tFmt, renderTrends, tChart, tSetGran, and the
 * control and Export handlers of both screens. */

/* ================= PLACEMENT =================
 * Where the ad was shown — top of search, rest of search, product page, off Amazon — day by day.
 *
 * SPEND MISALLOCATION is ours, not Amazon's: money spent on clicks that produced no order at all.
 * It is counted per CAMPAIGN × PLACEMENT over the whole window, never per day, because ad sales are
 * attributed to the CLICK date and keep collecting orders for about a month. Counted daily, most
 * recent spend would look wasted and the figure would improve on its own as the data matured.
 */
// The nightly placement cache: at = when built, d = per brand { byPlace, mis, byDate, worst }.
let PLC = { at: '', d: {}, loaded: false };
// The chart's bucket: day / week / month.
let PLC_GRAN = 'day';
// The order the four known placements are listed in, and their colours; anything else is grey.
const PLC_ORDER = ['Top of Search', 'Rest of Search', 'Product Page', 'Off Amazon'];
const PLC_COLOR = {
  'Top of Search': 'var(--accent)',
  'Product Page': 'var(--muted)',
  'Rest of Search': 'var(--act)',
  'Off Amazon': 'var(--brand)' };
const plcColor = p => PLC_COLOR[p] || 'var(--faint)';
/* Amazon's own wording, which is not the wording anybody uses. Verified against live rows:
 * `placementClassification` comes back as "Detail Page on-Amazon", not "Product Page".
 *
 * Mapped HERE, on the way to the screen, and never in the collector — the cache keeps Amazon's raw
 * value, so a wrong guess in this table is a one-line fix instead of a re-collection.
 *
 * Anything not listed passes through VERBATIM rather than becoming "Other". A placement Amazon adds
 * next year should appear under its own name and be noticed, not silently swept into a bucket. */
const PLC_LABEL = {
  'Top of Search on-Amazon': 'Top of Search',
  'Detail Page on-Amazon': 'Product Page',
  'Other on-Amazon': 'Rest of Search',
  'Off Amazon': 'Off Amazon',
};
// Our name for one of Amazon's raw placement values; unknown ones pass through as they are.
const plcName = raw => PLC_LABEL[raw] || String(raw || 'Unknown');
// Write the Placement message line (HTML allowed); bad = true shows it in red (class err), otherwise muted.
function plcMsg(t, bad) {
  const m = $('plcMsg');
  m.innerHTML = t || '';
  m.className = bad ? 'err' : 'muted';
}

// Called when the tab opens: fetch the placement cache once, then draw.
async function ensurePlc() {
  if (!PLC.loaded) {
    plcMsg('Loading…');
    try {
      const r = await baCall({ cache: 'placement' });
      PLC = { at: (r.data && r.data.at) || '', d: (r.data && r.data.d) || {}, loaded: true };
      plcMsg('');
    } catch (e) {
      PLC.loaded = true;
      plcMsg('The nightly run has not collected placement data yet — it asks Amazon overnight and '
        + 'picks the report up on a later wake-up.', true);
    }
  }
  renderPlc();
}

// The brands chosen in the picker.
const plcBrands = () => ($('plcBrand').value === 'ALL' ? ['SP', 'CPC'] : [$('plcBrand').value]);
// Sunday-start weeks and calendar months, both read in UTC off a plain YYYY-MM-DD. These dates carry
// no zone; re-formatting them in one is how every date bug in this app has started.
const plcBucket = iso => {
  if (PLC_GRAN === 'month') return iso.slice(0, 7);
  if (PLC_GRAN === 'week') {
    const d = new Date(iso + 'T00:00:00Z');
    return new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);
  }
  return iso;
};

/** Totals per placement across the chosen brands, plus the buckets for the chart. */
// { place, mis, names, buckets, worst }: per-placement totals [impr, clicks, spend, orders, sales], the
// misallocated spend per placement, the placement names in display order, the chart buckets, and the worst
// campaign × placement rows by spend.
function plcAgg() {
  const brands = plcBrands();
  const place = {}, mis = {}, buckets = new Map(), worst = [];
  const blank = () => [0, 0, 0, 0, 0];
  const addTo = (t, v) => { for (let i = 0; i < 5; i++) t[i] += v[i] || 0; };
  brands.forEach(b => {
    const pack = PLC.d[b];
    if (!pack) return;
    // Every read goes through plcName, so two raw values that mean the same thing land in one row
    // rather than two that each look half the size.
    Object.entries(pack.byPlace || {}).forEach(([p, v]) =>
      addTo(place[plcName(p)] || (place[plcName(p)] = blank()), v));
    Object.entries(pack.mis || {}).forEach(([p, v]) => {
      const n = plcName(p);
      mis[n] = (mis[n] || 0) + (v || 0);
    });
    Object.entries(pack.byDate || {}).forEach(([day, byP]) => {
      const k = plcBucket(day);
      const box = buckets.get(k) || (buckets.set(k, {}), buckets.get(k));
      Object.entries(byP).forEach(([p, v]) => {
        const n = plcName(p);
        addTo(box[n] || (box[n] = blank()), v);
      });
    });
    (pack.worst || []).forEach(w => worst.push({ ...w, p: plcName(w.p), brand: b }));
  });
  worst.sort((a, b) => b.sp - a.sp);
  const names = [...new Set([...PLC_ORDER.filter(p => place[p]), ...Object.keys(place)])];
  return { place, mis, names, buckets, worst };
}

// Draw the Placement screen: the spend strip, the chart, the table with its TOTAL row, the worst offenders, the message.
function renderPlc() {
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  // --- nothing collected yet ---
  if (!Object.keys(PLC.d).length) {
    $('plcKpis').innerHTML = '';
    $('plcChart').innerHTML = '';
    $('plcTable').innerHTML = '';
    $('plcWorst').innerHTML = '';
    return;
  }

  // --- the spend strip ---
  const A = plcAgg();
  const totSpend = A.names.reduce((s, p) => s + A.place[p][2], 0);

  $('plcKpis').innerHTML = A.names.map(p =>
    `<div><div class="muted" style="font-size:11px"><span style="display:inline-block;width:9px;height:9px;`
    + `border-radius:2px;background:${plcColor(p)};margin-right:5px"></span>${esc(p)}</div>`
    + `<div style="font-weight:700;font-size:15px">${money(A.place[p][2])}</div></div>`).join('')
    + `<div><div class="muted" style="font-size:11px">Total</div>`
    + `<div style="font-weight:700;font-size:15px">${money(totSpend)}</div></div>`;

  // --- the chart ---
  plcChartSvg(A, esc, money);

  // --- the table ---
  const row = (label, t, misV, bold) => {
    const [i, c, sp, o, s] = t;
    const pctOf = totSpend > 0 ? Math.round(sp * 100 / totSpend) : 0;
    return `<tr${bold ? ' style="font-weight:700;border-top:2px solid var(--line)"' : ''}>`
      + `<td class="frz">${label}</td>`
      + `<td class="num"${misV > 0 ? ' style="color:var(--bad-ink)"' : ''}>${money(misV)}`
        + `${sp > 0 && misV > 0 ? ` <span class="muted">(${Math.round(misV * 100 / sp)}%)</span>` : ''}</td>`
      + `<td class="num">${money(sp)}${bold ? '' : ` <span class="muted">(${pctOf}%)</span>`}</td>`
      + `<td class="num">${money(s)}</td>`
      + `<td class="num">${s > 0 ? (sp * 100 / s).toFixed(1) + '%' : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${nf(c)}</td><td class="num">${nf(o)}</td>`
      + `<td class="num">${c > 0 ? '$' + (sp / c).toFixed(2) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${c > 0 ? (o * 100 / c).toFixed(1) + '%' : '<span class="muted">—</span>'}</td>`
      + '</tr>';
  };
  const head = '<thead><tr><th class="frz">Placement</th>'
    + '<th class="num" title="Spend on clicks that produced no order at all, counted per campaign per placement across the whole window. '
      + 'Ours, not Amazon\'s.">Spend Misallocation</th>'
    + '<th class="num">Ad Spend</th><th class="num">Ad Sales</th><th class="num">ACOS</th>'
    + '<th class="num">Clicks</th><th class="num">Orders</th><th class="num">CPC</th><th class="num">CVR</th>'
    + '</tr></thead>';
  const T = A.names.reduce((t, p) => {
    const v = A.place[p];
    return [t[0] + v[0], t[1] + v[1], t[2] + v[2], t[3] + v[3], t[4] + v[4]];
  }, [0, 0, 0, 0, 0]);
  const totMis = Object.values(A.mis).reduce((s, v) => s + v, 0);
  $('plcTable').innerHTML = head + '<tbody>'
    + A.names.map(p => row(esc(p), A.place[p], A.mis[p] || 0)).join('')
    + row('TOTAL', T, totMis, true) + '</tbody>';

  // --- worst offenders ---
  $('plcWorst').innerHTML = A.worst.length
    ? '<thead><tr><th class="frz">Campaign</th><th>Placement</th><th>Brand</th>'
      + '<th class="num">Clicks</th><th class="num">Spend, nothing back</th></tr></thead><tbody>'
      + A.worst.slice(0, 200).map(w => `<tr><td class="frz">${esc(w.cn)}</td>`
        + `<td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;`
        + `background:${plcColor(w.p)};margin-right:5px"></span>${esc(w.p)}</td>`
        + `<td>${esc(w.brand === 'SP' ? 'Ridhi' : w.brand)}</td>`
        + `<td class="num">${nf(w.c)}</td>`
        + `<td class="num" style="color:var(--bad-ink);font-weight:600">${money(w.sp)}</td></tr>`).join('')
      + '</tbody>'
    : '<tbody><tr><td class="muted" style="padding:12px">Nothing — every campaign and placement that '
      + 'took a click also produced at least one order.</td></tr></tbody>';

  // --- the message line ---
  plcMsg(`${A.names.length} placement(s) · ${money(totSpend)} spent, ${money(T[4])} back`
    + ` · <b style="color:var(--bad-ink)">${money(totMis)}</b> of it bought nothing`
    + (PLC.at ? ` · built ${esc(PLC.at)}` : '') + ' · a 30-day window');
}

/* Hand-drawn stacked bars. This app deliberately loads no charting library — one <script> from a CDN
 * is a third party that can break every tab in it. */
// Draw the stacked bars into plcChart: one bar per bucket, one colour per placement, spend on the y axis.
function plcChartSvg(A, esc, money) {
  const keys = [...A.buckets.keys()].sort();
  if (!keys.length) {
    $('plcChart').innerHTML = '';
    return;
  }
  // --- the scale ---
  const H = 240, PAD_L = 54, PAD_B = 26, PAD_T = 10;
  const bw = PLC_GRAN === 'day' ? 26 : PLC_GRAN === 'week' ? 54 : 76;
  const W = Math.max(640, PAD_L + keys.length * bw + 16);
  const tot = k => A.names.reduce((s, p) => s + ((A.buckets.get(k)[p] || [])[2] || 0), 0);
  const max = Math.max(...keys.map(tot), 1);
  // A round number above the tallest bar, so the axis reads in figures somebody would say out loud.
  const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
  const top = Math.ceil(max / step) * step;
  const y = v => PAD_T + (H - PAD_T - PAD_B) * (1 - v / top);
  // --- grid lines and the y axis ---
  let g = '';
  for (let t = 0; t <= top; t += step) {
    g += `<line class="ad-ch-grid" x1="${PAD_L}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/>`
      + `<text x="${PAD_L - 8}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">$${Math.round(t).toLocaleString('en-US')}</text>`;
  }
  // --- the bars and their labels ---
  const label = k => PLC_GRAN === 'month'
    ? k : (Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10)));
  let bars = '';
  keys.forEach((k, i) => {
    const x = PAD_L + i * bw + 3, w = bw - 6;
    let acc = 0;
    const box = A.buckets.get(k);
    const tip = A.names.filter(p => (box[p] || [])[2] > 0)
      .map(p => `${p} ${money(box[p][2])}`).join('\n');
    A.names.forEach(p => {
      const v = (box[p] || [])[2] || 0;
      if (!v) return;
      const h = (H - PAD_T - PAD_B) * v / top;
      acc += h;
      bars += `<rect x="${x}" y="${y(0) - acc}" width="${w}" height="${h}" fill="${plcColor(p)}">`
        + `<title>${esc(label(k) + '\n' + tip)}</title></rect>`;
    });
    // Every other label when the bars are narrow, or they collide into a grey smear.
    if (PLC_GRAN !== 'day' || i % 3 === 0) {
      bars += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(label(k))}</text>`;
    }
  });
  $('plcChart').innerHTML = `<svg width="${W}" height="${H}" role="img">${g}${bars}</svg>`;
}

// The day / week / month control redraws with the new bucket; the brand picker redraws at once.
$('plcGranSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  PLC_GRAN = b.dataset.g;
  $('plcGranSeg').querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
  renderPlc();
});
$('plcBrand').addEventListener('change', renderPlc);

// Export: the placement table, a blank line, then the worst offenders, as one CSV.
$('plcCsv').onclick = () => {
  const A = plcAgg();
  if (!A.names.length) {
    plcMsg('Nothing to export.', true);
    return;
  }
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // --- the placement table ---
  const lines = [['Placement', 'Spend Misallocation', 'Ad Spend', 'Ad Sales', 'ACOS %', 'Impressions',
    'Clicks', 'Orders', 'CPC', 'CVR %'].map(cell).join(',')];
  A.names.forEach(p => {
    const [i, c, sp, o, s] = A.place[p];
    lines.push([p, A.mis[p] || 0, sp, s, s > 0 ? (sp * 100 / s).toFixed(1) : '', i, c, o,
      c > 0 ? (sp / c).toFixed(2) : '', c > 0 ? (o * 100 / c).toFixed(1) : ''].map(cell).join(','));
  });
  // --- the worst offenders ---
  lines.push('');
  lines.push(['Campaign', 'Placement', 'Brand', 'Clicks', 'Spend that bought nothing'].map(cell).join(','));
  A.worst.forEach(w => lines.push([w.cn, w.p, w.brand, w.c, w.sp].map(cell).join(',')));
  // --- download ---
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'placement-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};

// Called when the Ad Console opens: load the cached snapshot, draw, fold in last night's run (at most every
// ten minutes), and collect any ad reports Amazon has finished since last time.
async function ensureTrends() {
  // --- the cached snapshot ---
  if (!TREND.at && !Object.keys(TREND.d.SP).length && !Object.keys(TREND.d.CPC).length) {
    tMsg('Loading…');
    await loadTrends();
    tMsg('');
  }
  renderTrends();
  // --- last night's run ---
  // Fold in last night's run before anything else, so the tab is current on arrival rather than one
  // click later. Throttled: flicking between tabs must not re-read the sheets every time.
  if (!T_BUSY && Date.now() - T_NIGHT_RUN > 600000) {
    tMsg('Bringing in last night\'s figures…');
    let from = '';
    try { from = await tNightly(); } catch (e) { /* fall through to whatever is on screen */ }
    renderTrends();
    tMsg(from ? `Up to date — nightly run of ${from}, plus today read live.` : '');
  }
  // --- queued ad reports ---
  // One cheap sweep for reports Amazon has finished since last time. This is what makes the
  // ask-now-collect-later design work without anybody having to remember to come back and press
  // something: opening the tab is the reminder.
  if (TREND.pending.length) {
    tMsg(`Checking ${TREND.pending.length} ad report${TREND.pending.length === 1 ? '' : 's'} queued earlier…`);
    const got = await tCollect(1, false);
    tMsg(got
      ? `Collected ${got} ad report${got === 1 ? '' : 's'} that finished since last time.`
      : `${TREND.pending.length} ad report${TREND.pending.length === 1 ? '' : 's'} still building at Amazon's end — open this tab again in a few minutes.`);
  }
}

// The day's array in TREND for one brand, created (all zeros) when it is not there yet.
const tCell = (brand, day) => {
  const b = TREND.d[brand] || (TREND.d[brand] = {});
  return b[day] || (b[day] = new Array(T_LEN).fill(0));
};

/**
 * baCall with retries, for the long grinding loops.
 *
 * A chunk that dies takes the whole refresh with it otherwise, and the commonest cause is not a bug
 * but Apps Script being briefly slow — the browser gives up, and the very same request succeeds a
 * moment later. Retrying the network layer costs nothing; giving up costs the whole run.
 */
// baCall, retried up to `tries` times on a bare network error (2 s, then 4 s, then 6 s apart); other errors throw at once.
async function tCall(params, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await baCall(params);
    } catch (e) {
      last = e;
      // A real answer from the backend ("no such workbook") will never succeed on a retry.
      if (!/failed to fetch|networkerror|load failed/i.test(String(e.message || e))) throw e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

// Refresh (or Stop, when one is running): rescan the Orders workbooks for daily sales, then ask Amazon for the ad
// reports that can still change and collect the quick ones; every failure is reported at the end.
async function trendsRefresh() {
  if (T_BUSY) {
    T_STOP = true;
    tMsg('Stopping after the current step — everything fetched so far is saved.');
    return;
  }
  // --- busy ---
  T_BUSY = true;
  T_STOP = false;
  $('tRefresh').textContent = 'Stop';
  const failed = [];
  try {
    /* --- 1. sales, units and DISTINCT orders per day, from the Orders workbooks --- */
    // Each workbook is guarded on its own. One brand's sheet failing must not stop the other brand,
    // and above all must not stop the ad step — that is what happened before, and it looked from the
    // outside like the ads were broken when they had simply never been asked for.
    let books = 2;
    for (let book = 0; book < books && !T_STOP; book++) {
      const brand = book === 0 ? 'SP' : 'CPC';       // ORDERS_DATA_IDS is [Ridhi, CPC] on the backend
      try {
        TREND.d[brand] = {};                           // a full rescan replaces, so a deleted row disappears
        let start = 2, guard = 0, prevLast = '';
        for (;;) {
          // 8,000, not 20,000: this scan does more per row than the weekly one, and a request that
          // outlives the browser's patience dies as a bare network error with nothing to act on.
          // Smaller chunks mean more round trips and none of them in danger.
          const d = await tCall({ daily: 'sales', book, start, n: 8000, days: T_DAYS });
          books = d.books || books;
          Object.entries(d.dates || {}).forEach(([day, v]) => {
            const c = tCell(brand, day);
            c[T_I.sales] = Math.round((c[T_I.sales] + (v[0] || 0)) * 100) / 100;
            c[T_I.units] += v[1] || 0;
            c[T_I.orders] += v[2] || 0;
          });
          // One order's lines sit together in the sheet, so if a chunk starts with the same order the
          // previous one ended on, that order has just been counted twice. Take one back.
          if (prevLast && d.firstOrder && prevLast === d.firstOrder) {
            const day = Object.keys(d.dates || {})[0];
            if (day) {
              const c = tCell(brand, day);
              c[T_I.orders] = Math.max(0, c[T_I.orders] - 1);
            }
          }
          prevLast = d.lastOrder || prevLast;
          const done = Math.min(start + (d.read || 0) - 1, d.lastRow || 0);
          tMsg(`Sales — ${BRAND_NAME[brand]}, row ${done.toLocaleString('en-US')} of ${(d.lastRow || 0).toLocaleString('en-US')}…`);
          if (d.done || !d.next) break;
          start = d.next;
          if (++guard > 600) throw new Error('Orders scan did not terminate.');
        }
      } catch (err) {
        failed.push(`${BRAND_NAME[brand]} sales: ${err.message || err}`);
        tMsg(`Sales — ${BRAND_NAME[brand]} stopped: ${err.message || err}. Carrying on with the rest.`, true);
      }
    }
    TREND.at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await saveTrends();
    renderTrends();

    /* --- 2. ad figures per day, in 31-day slices (the Ads API limit) ---
     *
     * ASK NOW, COLLECT LATER. Amazon builds these reports on its own schedule — a request can sit at
     * PENDING for well over ten minutes — so waiting for them inside one click was never going to be
     * reliable. The reportId survives, so it is stored and the download happens whenever the report
     * is actually ready: later in this run, on the next Refresh, or simply the next time the tab is
     * opened. Nothing is lost by walking away.
     */
    if (!T_STOP) {
      // --- the slices to ask for ---
      const today = new Date();
      const end0 = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - 86400000);
      const iso = x => x.toISOString().slice(0, 10);
      const slices = [];
      for (let off = 0; off < T_ADS_LOOKBACK; off += 31) {
        const e = new Date(end0.getTime() - off * 86400000);
        const s = new Date(e.getTime() - Math.min(30, T_ADS_LOOKBACK - off - 1) * 86400000);
        slices.push([iso(s), iso(e)]);
      }
      // Anything ending before this is finished changing and never needs asking for again.
      const settled = iso(new Date(end0.getTime() - T_AD_SETTLE_DAYS * 86400000));
      // --- ask Amazon for each slice not already settled or queued ---
      let skipped = 0;
      for (const brand of tBrands()) {
        for (const [s, e] of slices) {
          if (T_STOP) break;
          // Already collected AND old enough to have stopped moving — skip it. This is what turns a
          // full 95-day re-pull into "just the last month" on every run after the first.
          if (TREND.adDone[tSliceKey(brand, s, e)] && e < settled) {
            skipped++;
            continue;
          }
          // Already queued and waiting? Do not ask twice — a duplicate request is another few
          // minutes of Amazon's queue for an answer that is already on its way.
          if (TREND.pending.some(p => p.brand === brand && p.start === s && p.end === e)) continue;
          try {
            tMsg(`Ads — ${BRAND_NAME[brand]}, ${s} → ${e}: asking Amazon…`);
            const c0 = await tCall({ ads: 'ppcRange', brand, start: s, end: e });
            if (!c0.reportId) throw new Error('no report id');
            TREND.pending.push({ brand, start: s, end: e, id: c0.reportId, asked: Date.now() });
            await saveTrends();
          } catch (err) {
            failed.push(`${BRAND_NAME[brand]} ads ${s}: ${err.message || err}`);
          }
        }
      }
      if (skipped) tMsg(`Ads — ${skipped} window(s) already settled and skipped. Asking only for what can still change…`);
      // --- collect the quick ones, then record the window asked for ---
      // Wait a while for the ones that finish quickly, then leave the rest queued.
      await tCollect(20, true);
      TREND.adAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      TREND.adFrom = slices.length ? slices[slices.length - 1][0] : TREND.adFrom;
      TREND.adTo = slices.length ? slices[0][1] : TREND.adTo;
      await saveTrends();
    }
    renderTrends();
    // --- report ---
    // Every failure is reported at the end, not just the last one — a run that half worked is the
    // hardest kind to debug from a single line of red text.
    const queued = TREND.pending.length
      ? ` ${TREND.pending.length} ad report${TREND.pending.length === 1 ? '' : 's'} still building at Amazon's end — they are queued, and get collected next time you open this tab.`
      : '';
    tMsg(T_STOP ? 'Stopped. Everything fetched so far is saved.'
      : (failed.length
        ? `Finished with ${failed.length} problem${failed.length === 1 ? '' : 's'} — ${failed.join(' · ')}.${queued}`
        : `Done. Sales as at ${TREND.at}.${queued}`), failed.length > 0);
  } catch (e) {
    const m = String(e.message || e);
    tMsg('Refresh failed: ' + m
      + (/permission/i.test(m) ? ' — your account needs the “Overview” permission (Settings → Access).' : ''), true);
    try { await saveTrends(); } catch (x) { /* nothing more to do */ }
  }
  // --- back to normal ---
  T_BUSY = false;
  T_STOP = false;
  $('tRefresh').textContent = 'Refresh';
}

/**
 * Download every queued report that Amazon has finished, and leave the rest queued.
 *
 * `rounds` is how many times to come back and check; with `wait` it pauses 15s between them. Called
 * with rounds=1 and no wait when the tab opens (a single cheap sweep), and with a larger number at
 * the end of a Refresh so the quick ones land in the same click.
 *
 * A report is only dropped from the queue once it has been downloaded, has FAILED outright, or is a
 * day old. Anything else stays — being slow is not the same as being lost, and re-asking would just
 * put a fresh request at the back of the same queue.
 */
// Collect the finished reports in TREND.pending into TREND.d (replacing each report's window); returns how many.
async function tCollect(rounds, wait) {
  if (!TREND.pending.length) return 0;
  let done = 0;
  for (let r = 0; r < rounds && TREND.pending.length && !T_STOP; r++) {
    // --- one pass over the queue ---
    for (const job of [...TREND.pending]) {
      if (T_STOP) break;
      try {
        const s = await tCall({ ads: 'ppcStatus', brand: job.brand, id: job.id });
        if (/fail|cancel/i.test(s.status || '')) {
          TREND.pending = TREND.pending.filter(p => p.id !== job.id);
          continue;
        }
        if (!s.ready) continue;
        const d = await tCall({ ads: 'ppcFetch', brand: job.brand, id: job.id, gran: 'day' });
        // The window is cleared only now, when its replacement is actually in hand. Clearing at
        // request time — which is what this used to do — wiped good figures for however long the
        // report took, and for ever if it never arrived.
        Object.keys(TREND.d[job.brand] || {}).forEach(day => {
          if (day >= job.start && day <= job.end) {
            const c = TREND.d[job.brand][day];
            c[T_I.impr] = c[T_I.clicks] = c[T_I.spend] = c[T_I.adOrders] = c[T_I.adSales] = 0;
          }
        });
        Object.entries(d.dates || {}).forEach(([day, v]) => {
          const c = tCell(job.brand, day);
          c[T_I.impr] += v[0] || 0;
          c[T_I.clicks] += v[1] || 0;
          c[T_I.spend] = Math.round((c[T_I.spend] + (v[2] || 0)) * 100) / 100;
          c[T_I.adOrders] += v[3] || 0;
          c[T_I.adSales] = Math.round((c[T_I.adSales] + (v[4] || 0)) * 100) / 100;
        });
        TREND.pending = TREND.pending.filter(p => p.id !== job.id);
        // Marked collected. Whether it is ever asked for again depends on its age, not on this flag
        // alone — a window inside the attribution period is re-fetched even though it is "done".
        TREND.adDone[tSliceKey(job.brand, job.start, job.end)] = 1;
        done++;
        await saveTrends();
        renderTrends();
      } catch (e) { /* still building, or a blip — it stays queued and gets another go */ }
    }
    // --- drop the stale, then wait for the next pass ---
    // A day old and still not ready means it never will be; drop it so the queue cannot grow for ever.
    TREND.pending = TREND.pending.filter(p => !p.asked || Date.now() - p.asked < 86400000);
    if (!TREND.pending.length || r === rounds - 1) break;
    tMsg(`Waiting on ${TREND.pending.length} report${TREND.pending.length === 1 ? '' : 's'} Amazon is still building — ${done} collected so far…`);
    if (wait) await new Promise(x => setTimeout(x, 15000));
  }
  return done;
}


/* ---------- rolling days up into the chosen period ---------- */
// Weeks run Sunday→Saturday to match Seller Central; months and quarters are calendar.
// The period key of one day under T_GRAN: the day itself, its week's Sunday, 'yyyy-MM' or 'yyyy-Qn'.
function tPeriodKey(day) {
  const d = new Date(day + 'T00:00:00Z');
  if (T_GRAN === 'day') return day;
  if (T_GRAN === 'week') return new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);
  if (T_GRAN === 'month') return day.slice(0, 7);
  return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
}
// The column title of one period key: "Aug '26", "Q3 '26", the week label, or "Aug 3".
function tPeriodLabel(k) {
  if (T_GRAN === 'month') {
    const [y, m] = k.split('-');
    return W_MON[Number(m) - 1] + " '" + y.slice(2);
  }
  if (T_GRAN === 'quarter') {
    const [y, q] = k.split('-');
    return q + " '" + y.slice(2);
  }
  if (T_GRAN === 'week') return wLabel(k);
  const d = new Date(k + 'T00:00:00Z');
  return W_MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

// Roll TREND's days into periods for the chosen brands: { keys, agg, adKnown, from, to }. o = { n } for the last n periods, or
// { from, to } for only the days in that range (every period they touch, its edges holding just those days); left out, the
// page's own choice (tRange).
function tSeries(o) {
  const r = o || tRange();
  // --- add the days up per period ---
  const brand = $('tBrand').value;
  const brands = brand === 'ALL' ? adBrands() : [brand].filter(b => adBrands().includes(b));
  const agg = {}, adDays = {}, allDays = {};
  brands.forEach(b => Object.entries(TREND.d[b] || {}).forEach(([day, v]) => {
    if (r.from && (day < r.from || day > r.to)) return;
    const k = tPeriodKey(day);
    const t = agg[k] || (agg[k] = new Array(T_LEN).fill(0));
    for (let i = 0; i < T_LEN; i++) t[i] += v[i] || 0;
    allDays[k] = (allDays[k] || 0) + 1;
    if (TREND.adFrom && day >= TREND.adFrom && day <= TREND.adTo) adDays[k] = (adDays[k] || 0) + 1;
  }));
  // --- which periods have complete ad figures ---
  // A period only counts as having ad figures if EVERY day of it is inside the fetched window. A
  // half-covered week would report a spend for seven days that was really earned in three, and the
  // ratios built on it — TACOS, ACOS, organic share — would all be quietly wrong.
  const adKnown = {};
  Object.keys(agg).forEach(k => { adKnown[k] = !!adDays[k] && adDays[k] === allDays[k]; });
  const keys = Object.keys(agg).sort();
  if (r.from) return { keys, agg, adKnown, from: r.from, to: r.to };
  const span = r.n || 26;
  // "Last 1" is the last FULL period (yesterday, last week…): the running one alone has no ad figures yet.
  const pool = span === 1 ? keys.filter(k => k < tPeriodKey(sdToday())) : keys;
  return { keys: pool.slice(-span), agg, adKnown };
}

// Derived metrics are computed from the SUMS, never averaged from each period's ratio — a quiet week
// would otherwise pull the overall ACOS around as hard as the biggest one.
// `ad: 1` marks a row that only means anything where the ad figures were actually fetched. Those
// return null outside that window instead of zero — a dash says "not known", a zero says "nothing
// was spent", and for months outside Amazon's retention only the first is true.
// The table's rows: key, title, format (money / money2 / pct / dec), whether ad-dependent, and the value from a period's array.
const T_ROWS = [
  { k: 'sales', t: 'Sales', money: 1, get: v => v[T_I.sales] },
  { k: 'spend', t: 'Ad Spend', money: 1, ad: 1, get: v => v[T_I.spend] },
  { k: 'tacos', t: 'TACOS', pct: 1, ad: 1, get: v => (v[T_I.sales] ? v[T_I.spend] / v[T_I.sales] * 100 : null) },
  { k: 'adSales', t: 'Ad Sales', money: 1, ad: 1, get: v => v[T_I.adSales] },
  { k: 'acos', t: 'ACOS', pct: 1, ad: 1, get: v => (v[T_I.adSales] ? v[T_I.spend] / v[T_I.adSales] * 100 : null) },
  { k: 'organic', t: 'Organic Sales', money: 1, ad: 1, get: v => Math.max(0, v[T_I.sales] - v[T_I.adSales]) },
  { k: 'organicPct', t: 'Organic %', pct: 1, ad: 1,
    get: v => (v[T_I.sales] ? Math.max(0, v[T_I.sales] - v[T_I.adSales]) / v[T_I.sales] * 100 : null) },
  { k: 'roas', t: 'ROAS', dec: 2, ad: 1, get: v => (v[T_I.spend] ? v[T_I.adSales] / v[T_I.spend] : null) },
  { k: 'cpc', t: 'CPC', money2: 1, ad: 1, get: v => (v[T_I.clicks] ? v[T_I.spend] / v[T_I.clicks] : null) },
  { k: 'orders', t: 'Orders', get: v => v[T_I.orders] },
  { k: 'adOrders', t: 'Ad Orders', ad: 1, get: v => v[T_I.adOrders] },
  { k: 'units', t: 'Units', get: v => v[T_I.units] },
  { k: 'clicks', t: 'Clicks', ad: 1, get: v => v[T_I.clicks] },
  { k: 'impr', t: 'Impressions', ad: 1, get: v => v[T_I.impr] },
  { k: 'ctr', t: 'CTR', pct: 1, ad: 1, get: v => (v[T_I.impr] ? v[T_I.clicks] / v[T_I.impr] * 100 : null) },
  { k: 'cvr', t: 'CVR', pct: 1, ad: 1, get: v => (v[T_I.clicks] ? v[T_I.adOrders] / v[T_I.clicks] * 100 : null) },
];

// Format one table value by its row's kind; null is a muted dash.
function tFmt(row, v) {
  if (v == null) return '<span class="muted">—</span>';
  if (row.money) return '$' + Math.round(v).toLocaleString('en-US');
  if (row.money2) return '$' + v.toFixed(2);
  if (row.pct) return v.toFixed(1) + '%';
  if (row.dec) return v.toFixed(row.dec);
  return Math.round(v).toLocaleString('en-US');
}

// Draw the Ad Console: the card over the visible span, the chart, and the metrics × periods table.
function renderTrends() {
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // --- the periods and their totals ---
  const { keys, agg, adKnown } = tSeries();
  const total = new Array(T_LEN).fill(0);
  keys.forEach(k => { for (let i = 0; i < T_LEN; i++) total[i] += agg[k][i]; });

  /**
   * A second total over ONLY the periods that have ad figures.
   *
   * Every ad ratio has to divide by the sales of the same days it spent on — mixing a covered period
   * with an uncovered one divides real spend by inflated sales and understates TACOS. That much was
   * always true. What was wrong was the response: blanking the entire row the moment ONE period was
   * uncovered. Today is always uncovered until the night's reports land, so a 26-day view with 25
   * good days showed nothing at all.
   *
   * Now the ad figures are totalled over the covered days and the header says how many that is. The
   * ratios stay honest because both sides of every division come from the same set.
   */
  const covered = keys.filter(k => adKnown[k]);
  const adTot = new Array(T_LEN).fill(0);
  covered.forEach(k => { for (let i = 0; i < T_LEN; i++) adTot[i] += agg[k][i]; });
  const adAny = covered.length > 0;
  const adAll = keys.length > 0 && covered.length === keys.length;

  // --- the card ---
  /* KPIs — the whole visible span, on the same footing as the table's Total column. */
  const kpi = (label, val, colour) =>
    `<div class="metric"><div class="v" style="font-size:15px${colour ? ';color:' + colour : ''}">${val}</div><div class="l">${label}</div></div>`;
  const tac = adAny && adTot[T_I.sales] ? adTot[T_I.spend] / adTot[T_I.sales] * 100 : null;
  const aco = adAny && adTot[T_I.adSales] ? adTot[T_I.spend] / adTot[T_I.adSales] * 100 : null;
  const ctr = adAny && adTot[T_I.impr] ? adTot[T_I.clicks] / adTot[T_I.impr] * 100 : null;
  const money = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
  const unit = T_GRAN + (covered.length === 1 ? '' : 's');
  // Said plainly whenever the ad figures speak for a shorter span than the sales beside them. Sales
  // and Orders are not ad-dependent and always cover the whole view.
  const adNote = !TREND.adFrom ? ' · no ad figures pulled yet'
    : adAll ? ` · ads cover ${esc(TREND.adFrom)} → ${esc(TREND.adTo)}`
    : adAny ? ` · ad figures over ${covered.length} of ${keys.length} ${T_GRAN}s (to ${esc(TREND.adTo)})`
    : ` · no ad figures in this span (ads cover ${esc(TREND.adFrom)} → ${esc(TREND.adTo)})`;
  const adLbl = l => (adAll || !adAny) ? l : `${l} · ${covered.length}${T_GRAN[0]}`;
  $('tKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">${esc(BRAND_NAME[$('tBrand').value] || 'Both brands')} — ${tSpanName(keys.length)}</span>
      <span class="kpiwhen">${TREND.at ? 'sales as at ' + esc(TREND.at) : 'not pulled yet'}${adNote}</span></div>
    <div class="metrics">
      ${kpi('Sales', money(total[T_I.sales]))}
      ${kpi(adLbl('Ad Spend'), money(adAny ? adTot[T_I.spend] : null))}
      ${kpi(adLbl('TACOS'), tac == null ? '—' : tac.toFixed(1) + '%', tac != null && tac > 20 ? 'var(--bad-ink)' : '')}
      ${kpi(adLbl('Ad Sales'), money(adAny ? adTot[T_I.adSales] : null))}
      ${kpi(adLbl('ACOS'), aco == null ? '—' : aco.toFixed(1) + '%', aco != null && aco > 60 ? 'var(--bad-ink)' : '')}
      ${kpi(adLbl('Organic %'), adAny && adTot[T_I.sales] ? (Math.max(0, adTot[T_I.sales] - adTot[T_I.adSales]) / adTot[T_I.sales] * 100).toFixed(1) + '%' : '—')}
      ${kpi(adLbl('CTR'), ctr == null ? '—' : ctr.toFixed(2) + '%')}
      ${kpi('Orders', Math.round(total[T_I.orders]).toLocaleString('en-US'))}
    </div></div>`;

  // --- the chart ---
  tChart(keys, agg, adKnown);

  // --- build table: metrics down, periods across ---
  /* Metrics down the side, periods across the top — the shape a trends table is read in. */
  const head = '<thead><tr><th class="frz">Metric</th><th class="num">Total / Avg</th>'
    + keys.map(k => `<th class="num">${esc(tPeriodLabel(k))}</th>`).join('') + '</tr></thead>';
  const body = T_ROWS.map(row => {
    // The Total column re-derives the ratio from the totals rather than averaging the columns. An
    // ad row totals only the periods that have ad figures, so it stops going blank because today's
    // reports have not landed yet; the header says how many periods that is.
    const tot = row.ad ? (adAny ? row.get(adTot) : null) : row.get(total);
    return `<tr><td class="frz" style="font-weight:600">${esc(row.t)}${
        row.ad ? '<span class="muted" style="font-weight:400" title="Only available for the days the Amazon Ads API still holds — about 95 back"> ·</span>' : ''}</td>`
      + `<td class="num" style="font-weight:700;background:var(--soft)">${tFmt(row, tot)}</td>`
      + keys.map(k => {
        const v = (row.ad && !adKnown[k]) ? null : row.get(agg[k]);
        const tip = (row.ad && !adKnown[k])
          ? ' title="No ad figures for this period — Amazon keeps Sponsored Products data for about 95 days, '
            + 'and this is outside it"'
          : '';
        return `<td class="num"${tip}>${tFmt(row, v)}</td>`;
      }).join('')
      + '</tr>';
  }).join('');
  $('tTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${keys.length + 2}" class="muted" style="padding:14px">Nothing stored yet — hit “Refresh”.</td></tr>`)
    + '</tbody>';
  if (!keys.length) $('tTable').innerHTML = `<tbody><tr><td class="muted" style="padding:14px">Nothing stored yet — hit “Refresh”. Sales come back in a couple of minutes; the ad figures take longer.</td></tr></tbody>`;

  // --- the boxes, the two line charts and Campaign performance (ads/ads-charts.js) ---
  // Last, and fenced off: whatever happens in there, everything above is already on screen.
  try { ADSX.draw({ keys, agg, adKnown, total, adTot, covered }); } catch (e) { console.warn('[ads-charts]', e); }
}

/* ---------- the chart: sales and ad spend as bars, TACOS as a line ---------- */
// Hand-drawn SVG rather than a charting library: the page loads no external scripts, and this needs
// exactly one chart shape. Two scales, because a percentage and a dollar figure share no axis.
// Draw the Ad Console chart into tChart: sales and ad-spend bars per period on a dollar scale, TACOS as a line on a % scale.
// adKnown (from tSeries) marks the periods whose ad figures were fetched; the others get no spend bar and no TACOS point.
function tChart(keys, agg, adKnown) {
  if (!keys.length) {
    $('tChart').innerHTML = '';
    return;
  }
  // --- the scales ---
  const W = Math.max(680, keys.length * 46), H = 260;
  const padL = 62, padR = 48, padT = 14, padB = 34;
  const iw = W - padL - padR, ih = H - padT - padB;
  const maxMoney = Math.max(1, ...keys.map(k => agg[k][T_I.sales]));
  const adOk = k => !adKnown || adKnown[k];
  const tac = k => (agg[k][T_I.sales] && adOk(k) ? agg[k][T_I.spend] / agg[k][T_I.sales] * 100 : null);
  const maxPct = Math.max(5, ...keys.map(k => tac(k) || 0));
  const x = i => padL + (i + 0.5) * (iw / keys.length);
  const yM = v => padT + ih - (v / maxMoney) * ih;
  const yP = v => padT + ih - (v / maxPct) * ih;
  const bw = Math.max(4, (iw / keys.length) * 0.34);
  const esc = s => String(s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  // --- grid lines and the two y axes ---
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = padT + ih - (i / 4) * ih;
    g += `<line class="ad-ch-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f6"/>`
      + `<text class="ad-ch-axis" x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${money(maxMoney * i / 4)}</text>`
      + `<text class="ad-ch-pct" x="${W - padR + 8}" y="${y + 4}" font-size="10" fill="#ea580c">${(maxPct * i / 4).toFixed(0)}%</text>`;
  }
  // --- the bars ---
  keys.forEach((k, i) => {
    const v = agg[k];
    g += `<rect class="ad-ch-sales" x="${x(i) - bw}" y="${yM(v[T_I.sales])}" width="${bw}" height="${Math.max(0, padT + ih - yM(v[T_I.sales]))}" fill="#94a3b8" rx="1.5">`
      + `<title>${esc(tPeriodLabel(k))} — Sales ${money(v[T_I.sales])}</title></rect>`;
    // No spend bar where the ad figures are not known: the table shows a dash there, and a bar would say how much.
    if (!adOk(k)) return;
    g += `<rect class="ad-ch-spend" x="${x(i)}" y="${yM(v[T_I.spend])}" width="${bw}" height="${Math.max(0, padT + ih - yM(v[T_I.spend]))}" fill="#6366f1" rx="1.5">`
      + `<title>${esc(tPeriodLabel(k))} — Ad spend ${money(v[T_I.spend])}</title></rect>`;
  });
  // --- the TACOS line and its points ---
  // The TACOS line skips periods with no sales, or no ad figures, rather than dropping to zero — a gap
  // is honest, a plunge to the axis is a story that did not happen.
  let path = '', started = false;
  keys.forEach((k, i) => {
    const t = tac(k);
    if (t == null) {
      started = false;
      return;
    }
    path += (started ? ' L' : ' M') + x(i) + ' ' + yP(t);
    started = true;
  });
  g += `<path class="ad-ch-tacos" d="${path}" fill="none" stroke="#ea580c" stroke-width="2"/>`;
  keys.forEach((k, i) => {
    const t = tac(k);
    if (t == null) return;
    g += `<circle class="ad-ch-dot" cx="${x(i)}" cy="${yP(t)}" r="2.6" fill="#ea580c"><title>${esc(tPeriodLabel(k))} — TACOS ${t.toFixed(1)}%</title></circle>`;
  });
  // --- the x axis labels ---
  // Labels thin out rather than overlap once the periods get tight.
  const step = Math.ceil(keys.length / 14);
  keys.forEach((k, i) => {
    if (i % step) return;
    g += `<text class="ad-ch-label" x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#64748b">${esc(tPeriodLabel(k))}</text>`;
  });
  $('tChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:none">${g}</svg>`;
}

// Switch the Ad Console's period (day / week / month / quarter), mark the button, redraw.
// The "Last N" stretches each period offers — the page's list and each Ad Console chart's own.
const T_SPANS = { day: [1, 7, 14, 30, 60, 90], week: [1, 4, 7, 13, 26, 52], month: [1, 3, 6, 12, 24], quarter: [1, 2, 4, 8] };
const T_SPAN_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.31 };
// The "Last N" under period `to` closest to the same stretch of time as n under `from` (26 weeks → 6 months → 90 days),
// never under min (a chart needs at least two periods).
function tSpanFit(from, n, to, min) {
  if (n === 'custom') return n;
  const want = n * (T_SPAN_DAYS[from] || 7) / (T_SPAN_DAYS[to] || 7);
  const list = (T_SPANS[to] || T_SPANS.week).filter(v => v >= (min || 1));
  return list.reduce((b, v) => (Math.abs(v - want) < Math.abs(b - want) ? v : b), list[0]);
}
// The options of a "Last N" list for period g, with n chosen, from min up: "Last full week" (1), "Last 26 weeks"…
function tSpanOptions(g, n, min) {
  return (T_SPANS[g] || T_SPANS.week).filter(v => v >= (min || 1)).map(v => `<option value="${v}"${v === n ? ' selected' : ''}>`
    + `${v === 1 ? (g === 'day' ? 'Yesterday' : 'Last full ' + g) : `Last ${v} ${g}s`}</option>`).join('')
    + `<option value="custom"${n === 'custom' ? ' selected' : ''}>Custom dates…</option>`;
}
// The first and last day the store holds (any brand), and the custom range it starts on: 30 days, up to yesterday.
function tDayBounds() {
  let lo = '', hi = '';
  Object.values(TREND.d || {}).forEach(m => Object.keys(m || {}).forEach(d => {
    if (!lo || d < lo) lo = d;
    if (!hi || d > hi) hi = d;
  }));
  const y = sdShift(sdToday(), -1), to = hi && hi < y ? hi : y, from = sdShift(to, -29);
  return { lo, hi, from: lo && from < lo ? lo : from, to };
}
// Two picked days as a range { n: 'custom', from, to }, in order; a missing or broken one falls back to the starting range.
function tDates(a, b) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const d = ok(a) && ok(b) ? null : tDayBounds();
  let from = ok(a) ? a : d.from, to = ok(b) ? b : d.to;
  if (from > to) [from, to] = [to, from];
  return { n: 'custom', from, to };
}
// The page's stretch: { n } for "Last N", or its own two days for "Custom dates…".
function tRange() {
  const v = $('tSpan').value;
  return v === 'custom' ? tDates($('tFrom').value, $('tTo').value) : { n: Number(v) || 26 };
}
// A range as it reads: "3 Oct – 31 Oct", with the year on a day of another year.
function tRangeText(r) {
  const yr = sdToday().slice(0, 4);
  const f = s => {
    const x = new Date(s + 'T00:00:00Z');
    return x.getUTCDate() + ' ' + W_MON[x.getUTCMonth()] + (s.slice(0, 4) === yr ? '' : " '" + s.slice(2, 4));
  };
  return r.from === r.to ? f(r.from) : f(r.from) + ' – ' + f(r.to);
}
// Fill a pair of date boxes: the days the store holds, and the range (or the starting one) when they are empty.
function tDatesFill(f, t, r) {
  if (!f || !t) return;
  const b = tDayBounds();
  [f, t].forEach(x => {
    if (b.lo) x.min = b.lo;
    x.max = sdToday();
  });
  if (!f.value) f.value = (r && r.from) || b.from;
  if (!t.value) t.value = (r && r.to) || b.to;
}
// How the page's stretch reads: "last 26 weeks" — or, for "Last 1", "the last full week" / "yesterday".
function tSpanName(n) {
  const r = tRange();
  if (r.from) return tRangeText(r);
  if (r.n === 1) return T_GRAN === 'day' ? 'yesterday' : 'the last full ' + T_GRAN;
  return `last ${n} ${T_GRAN}${n === 1 ? '' : 's'}`;
}
function tSetGran(g) {
  const from = T_GRAN;
  T_GRAN = g;
  ['Day', 'Week', 'Month', 'Quarter'].forEach(x => $('tGran' + x).classList.toggle('on', x.toLowerCase() === g));
  // A new period keeps about the same stretch of time — 26 weeks become 6 months, not 26 months.
  if (from !== g) {
    const s = $('tSpan');
    s.innerHTML = tSpanOptions(g, tSpanFit(from, s.value === 'custom' ? 'custom' : Number(s.value) || 26, g));
  }
  renderTrends();
}
// The four period buttons; brand and span redraw at once; Refresh.
['Day', 'Week', 'Month', 'Quarter'].forEach(x => { $('tGran' + x).onclick = () => tSetGran(x.toLowerCase()); });
// "Custom dates…" shows the two days (the last 30 days to start with); either one changing redraws, like the list.
function tSpanChange() {
  const on = $('tSpan').value === 'custom', box = $('tCustom');
  if (box) {
    box.classList.toggle('hide', !on);
    if (on) tDatesFill($('tFrom'), $('tTo'));
  }
  renderTrends();
}
$('tBrand').addEventListener('change', renderTrends);
$('tSpan').addEventListener('change', tSpanChange);
['tFrom', 'tTo'].forEach(id => { if ($(id)) $(id).addEventListener('change', renderTrends); });
$('tRefresh').onclick = trendsRefresh;
// Export: the metrics × periods table as a CSV, with the ratios to two decimals and the counts rounded.
$('tExport').onclick = () => {
  const { keys, agg } = tSeries();
  const total = new Array(T_LEN).fill(0);
  keys.forEach(k => { for (let i = 0; i < T_LEN; i++) total[i] += agg[k][i]; });
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const raw = (row, v) => {
    const x = row.get(v);
    return x == null ? '' : (row.pct || row.dec || row.money2 ? Number(x).toFixed(2) : Math.round(x));
  };
  const lines = [['Metric', 'Total / Avg', ...keys.map(tPeriodLabel)].map(cell).join(',')];
  T_ROWS.forEach(row => lines.push([row.t, raw(row, total), ...keys.map(k => raw(row, agg[k]))]
    .map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `account-trends-${T_GRAN}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};
