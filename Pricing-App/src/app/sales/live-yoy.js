/* ================= SALES · LIVE VS LAST YEAR: a day by the hour against the matching day last year, live from Amazon =================
 * Screens: Live vs Last Year (ensureYoy runs when the tab opens — core/nav.js). In the Advertising menu; comes with PPC & Organic or Sales Dashboard (TAB_INHERIT).
 * Does: the Prime Day tracker (public/prime.html) made general — for any day, not only the sale. Asks the backend
 * (?live=yoy → Pricing-API/SalesLive.gs → Amazon's Sales API getOrderMetrics) for each brand: the day by hour so far, the
 * matching day last year by hour (same weekday = 364 days back, or the same date) and the same day last week by hour; and
 * (?live=range) a From–To run of days — 15 Nov to 1 Dec by default, the Black Friday / Cyber Monday weeks — against the
 * same run last year. Paints six sales cards and six advertising cards (yoyRenderAds — ad spend, TACoS, ACoS from the
 * Ads API report the backend stores every 15 minutes), an hourly chart, a running-total chart, the run's totals + day chart + day table,
 * and an hourly table, for Ridhi, CPC or both. Every date is Amazon.com's day (Pacific). Re-reads every 5 minutes while open on today.
 * "Same time" on a live day = last year's completed hours plus the same fraction of the current hour.
 * Main functions: ensureYoy, yoyLoad, yoyView, yoyRender, yoyBars, yoyLines, yoyTable. */

let YOY = {};              // brand → the backend's answer for the day on view
let YOY_KEY = '';          // the day + comparison it was read for
let YOY_AT = 0;            // when it was read (ms)
let YOY_BUSY = false;
let YOY_TIMER = null;
let YOY_BRAND = 'ALL';     // ALL (Ridhi + CPC), SP or CPC
let YOY_R = {};            // brand → the backend's answer for the From–To run (?live=range)
let YOY_R_KEY = '';        // the run + comparison it was read for
const YOY_BRANDS = { SP: 'Ridhi', CPC: 'CPC' };
const YOY_EVERY = 5 * 60 * 1000;

const yoyMoney = v => '$' + Math.round(v || 0).toLocaleString('en-US');
const yoyK = v => v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(v || 0);
const yoyInt = v => Math.round(v || 0).toLocaleString('en-US');
const yoyZero = () => ({ orders: 0, units: 0, sales: 0 });
const yoyAdd = (a, b) => ({ orders: a.orders + (b ? b.orders : 0), units: a.units + (b ? b.units : 0), sales: a.sales + (b ? b.sales : 0) });
const yoyScale = (r, f) => ({ orders: r.orders * f, units: r.units * f, sales: r.sales * f });
const yoyHour = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
const yoyNice = v => { if (!(v > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; };
// "Thu 20 Nov 2025" for a YYYY-MM-DD.
const yoyDate = (iso, year) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: year === false ? undefined : 'numeric' });
const yoyTime = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

// The message line: grey normally, red when bad.
function yoyMsg(text, bad) { const m = $('yoyMsg'); m.textContent = text || ''; m.className = bad ? 'err' : 'muted'; }

// Last year's matching day: the same weekday (364 days back — what Amazon's own YoY uses) or the same calendar date.
function yoyLyDay(day, mode) {
  if (mode !== 'date') return sdShift(day, -364);
  const y = Number(day.slice(0, 4)) - 1, md = day.slice(5) === '02-29' ? '02-28' : day.slice(5);
  return y + '-' + md;
}
// Black Friday (the day after the fourth Thursday of November) and Cyber Monday, as YYYY-MM-DD.
function yoyBfCm(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay();          // 0 = Sunday
  const thu4 = 1 + ((4 - nov1 + 7) % 7) + 21;
  const iso = d => new Date(Date.UTC(year, 10, d)).toISOString().slice(0, 10);
  return { bf: iso(thu4 + 1), cm: iso(thu4 + 4) };
}
// The default run: 15 November to 1 December of the year on view (the Black Friday / Cyber Monday weeks).
function yoyRangeDefaults() {
  if ($('yoyFrom').value && $('yoyTo').value) return;
  const y = ($('yoyDay').value || sdToday()).slice(0, 4);
  $('yoyFrom').value = y + '-11-15';
  $('yoyTo').value = y + '-12-01';
}

/* ---------- opening the tab ---------- */
function ensureYoy() {
  const today = sdToday();
  if (!$('yoyDay').value) $('yoyDay').value = today;
  $('yoyDay').max = today;
  yoyRangeDefaults();
  const key = $('yoyDay').value + '|' + $('yoyMode').value;
  if (key !== YOY_KEY || Date.now() - YOY_AT > YOY_EVERY) yoyLoad();
  else { yoyRender(); yoyRenderRange(); }
  if (!YOY_TIMER) YOY_TIMER = setInterval(() => {
    if (TAB_NOW === 'yoy' && document.visibilityState === 'visible' && $('yoyDay').value === sdToday()) yoyLoad();
  }, YOY_EVERY);
}

/* ---------- reading Amazon (both brands at once) ---------- */
async function yoyLoad() {
  if (YOY_BUSY) return;
  YOY_BUSY = true;
  const day = $('yoyDay').value || sdToday(), mode = $('yoyMode').value, ly = yoyLyDay(day, mode);
  const key = day + '|' + mode;
  const btn = $('yoyRefresh');
  btn.disabled = true; btn.textContent = 'Asking Amazon…';
  yoyMsg('');
  const errs = [];
  try {
    const rangeDone = yoyLoadRange(true);            // the From–To run, asked at the same time
    const got = await Promise.all(Object.keys(YOY_BRANDS).map(b =>
      baCall({ live: 'yoy', brand: b, day, ly })
        .then(r => [b, r])
        .catch(e => { errs.push(YOY_BRANDS[b] + ': ' + (e.message || e)); return [b, null]; })));
    errs.push(...(await rangeDone));
    // A new day or comparison replaces everything; a refresh of the same one keeps a brand that failed this time.
    const next = key === YOY_KEY ? Object.assign({}, YOY) : {};
    got.forEach(([b, r]) => { if (r) next[b] = r; });
    YOY = next; YOY_KEY = key; YOY_AT = Date.now();
    yoyRender();
    if (errs.length) yoyMsg('Could not read ' + errs.join(' · '), true);
  } finally {
    YOY_BUSY = false;
    btn.disabled = false; btn.textContent = 'Refresh';
  }
}

/* The From–To run for both brands. quiet = called from yoyLoad, which shows the errors itself (they are returned). */
async function yoyLoadRange(quiet) {
  const from = $('yoyFrom').value, to = $('yoyTo').value;
  if (!from || !to || from > to) { if (!quiet) yoyMsg('Pick a From date on or before the To date.', true); return []; }
  const day = $('yoyDay').value || sdToday(), mode = $('yoyMode').value;
  const shift = Math.round((Date.parse(day) - Date.parse(yoyLyDay(day, mode))) / 864e5);
  const key = from + '|' + to + '|' + shift, errs = [];
  const got = await Promise.all(Object.keys(YOY_BRANDS).map(b =>
    baCall({ live: 'range', brand: b, from, to, shift })
      .then(r => [b, r])
      .catch(e => { errs.push(YOY_BRANDS[b] + ' (day by day): ' + (e.message || e)); return [b, null]; })));
  const next = key === YOY_R_KEY ? Object.assign({}, YOY_R) : {};
  got.forEach(([b, r]) => { if (r) next[b] = r; });
  YOY_R = next; YOY_R_KEY = key;
  yoyRenderRange();
  if (!quiet && errs.length) yoyMsg('Could not read ' + errs.join(' · '), true);
  return errs;
}

/* ---------- the run, day by day ---------- */
function yoyRenderRange() {
  const keys = (YOY_BRAND === 'ALL' ? Object.keys(YOY_BRANDS) : [YOY_BRAND]).filter(k => YOY_R[k]);
  if (!keys.length) return;
  const A = YOY_R[keys[0]], dates = A.dates || [], lyDates = A.lyDates || [];
  // Summed across the brands on view, by date; null where this year has no figure yet (a day still to come).
  const sum = (field, d) => {
    let t = null;
    keys.forEach(k => { const r = (YOY_R[k][field] || {})[d]; if (r) t = yoyAdd(t || yoyZero(), r); });
    return t;
  };
  const now = dates.map(d => sum('now', d)), last = lyDates.map(d => sum('last', d) || yoyZero());
  const today = sdToday(), shift = Math.round((Date.parse(dates[0]) - Date.parse(lyDates[0])) / 864e5);
  $('yoyLgRange').textContent = 'Last year, ' + (shift === 364 ? 'same weekday' : 'same date') + ' (' + yoyDate(lyDates[0], false) + ' – ' + yoyDate(lyDates[lyDates.length - 1]) + ')';

  // --- the four figures: days already finished, against the same days last year (today is on the cards above) ---
  let done = yoyZero(), lyDone = yoyZero(), nDone = 0;
  dates.forEach((d, i) => { if (d < today && now[i]) { done = yoyAdd(done, now[i]); lyDone = yoyAdd(lyDone, last[i]); nDone++; } });
  const lyAll = last.reduce(yoyAdd, yoyZero());
  $('yoyRsNowLbl').textContent = 'This year, ' + nDone + ' day' + (nDone === 1 ? '' : 's') + ' done';
  $('yoyRsNow').textContent = nDone ? yoyMoney(done.sales) : '—';
  $('yoyRsNowSub').textContent = nDone ? yoyInt(done.orders) + ' orders · ' + yoyInt(done.units) + ' units' : 'the run has not started yet';
  $('yoyRsLy').textContent = nDone ? yoyMoney(lyDone.sales) : '—';
  $('yoyRsLySub').textContent = nDone ? yoyInt(lyDone.orders) + ' orders' : '';
  const chg = $('yoyRsChg');
  if (nDone && lyDone.sales) {
    const p = Math.round((done.sales / lyDone.sales - 1) * 100);
    chg.textContent = (p > 0 ? '+' : '') + p + '%'; chg.className = 'val ' + (p >= 0 ? 'yoy-up' : 'yoy-down');
    $('yoyRsChgSub').textContent = (done.sales >= lyDone.sales ? '+' : '−') + yoyMoney(Math.abs(done.sales - lyDone.sales)) + ' in sales';
  } else { chg.textContent = '—'; chg.className = 'val'; $('yoyRsChgSub').textContent = ''; }
  $('yoyRsLyAll').textContent = yoyMoney(lyAll.sales);
  $('yoyRsLyAllSub').textContent = yoyInt(lyAll.orders) + ' orders over ' + dates.length + ' days' + (nDone && lyAll.sales ? ' · ' + Math.round(done.sales / lyAll.sales * 100) + '% matched so far' : '');

  // --- chart: this year beside last year, Black Friday / Cyber Monday marked ---
  const ev = yoyBfCm(Number(dates[0].slice(0, 4)));
  const marks = dates.map((d, i) => (d === ev.bf ? { i, text: 'Black Friday' } : d === ev.cm ? { i, text: 'Cyber Monday' } : null)).filter(Boolean);
  yoyBars($('yoyDays'), dates.map(d => yoyDate(d, false).replace(/^(\w+) /, '$1\n')), [
    { vals: now.map(r => (r ? r.sales : null)), fill: 'var(--yoy-now)', name: 'This year', part: dates.indexOf(today), dates },
    { vals: last.map(r => r.sales), fill: 'var(--yoy-ly)', name: 'Last year', dates: lyDates },
  ], null, null, marks);

  // --- the days ---
  const pct = (a, b) => { if (!b) return '—'; const p = Math.round((a / b - 1) * 100); return `<span class="${p >= 0 ? 'yoy-up' : 'yoy-down'}">${p > 0 ? '+' : ''}${p}%</span>`; };
  $('yoyRangeTable').innerHTML = `<table class="yoy-tbl"><thead><tr><th>Day</th><th>Sales</th><th>Orders</th><th>Units</th><th>Last year</th><th>Sales</th><th>Orders</th><th>Change</th></tr></thead><tbody>`
    + dates.map((d, i) => {
      const a = now[i], b = last[i], isToday = d === today;
      return `<tr><td>${yoyDate(d, false)}${d === ev.bf ? ' · BF' : d === ev.cm ? ' · CM' : ''}</td>`
        + `<td>${a ? yoyMoney(a.sales) + (isToday ? ' <span class="muted">(so far)</span>' : '') : '<span class="muted">—</span>'}</td><td>${a ? yoyInt(a.orders) : ''}</td><td>${a ? yoyInt(a.units) : ''}</td>`
        + `<td>${yoyDate(lyDates[i])}</td><td>${yoyMoney(b.sales)}</td><td>${yoyInt(b.orders)}</td><td>${a && !isToday ? pct(a.sales, b.sales) : ''}</td></tr>`;
    }).join('') + '</tbody></table>';
}

/* ---------- the brands on view, merged hour by hour ---------- */
function yoyView() {
  const keys = (YOY_BRAND === 'ALL' ? Object.keys(YOY_BRANDS) : [YOY_BRAND]).filter(k => YOY[k]);
  if (!keys.length) return null;
  const merge = f => {
    const lists = keys.map(k => YOY[k][f] || []);
    const n = Math.max(0, ...lists.map(l => l.length));
    return [...Array(n).keys()].map(i => lists.reduce((t, l) => yoyAdd(t, l[i]), yoyZero()));
  };
  const A = YOY[keys[0]];
  return { keys, day: A.day, ly: A.ly, lw: A.lw, asOf: A.asOf, now: merge('now'), last: merge('last'), lastWeek: merge('lastWeek') };
}

/* ---------- painting ---------- */
function yoyRender() {
  const V = yoyView();
  if (!V) return;
  const live = V.day === sdToday();
  const n = V.now.length;                                     // hours read so far (the last one is a part hour when live)
  const pt = sdPT(Date.parse(V.asOf));
  const frac = live ? Math.max(0.02, (pt.getMinutes() + pt.getSeconds() / 60) / 60) : 1;
  // Last year (or last week) by the same moment: its completed hours, plus the same share of the current one.
  const sameTime = rows => {
    if (!live) return rows.reduce(yoyAdd, yoyZero());
    let t = yoyZero();
    rows.forEach((r, i) => { if (i < n - 1) t = yoyAdd(t, r); else if (i === n - 1) t = yoyAdd(t, yoyScale(r, frac)); });
    return t;
  };
  const today = V.now.reduce(yoyAdd, yoyZero());
  const lySame = sameTime(V.last), lwSame = sameTime(V.lastWeek);
  const lyDay = V.last.reduce(yoyAdd, yoyZero());
  const upTo = live ? ' by ' + yoyTime(V.asOf) : '';

  // --- cards ---
  const delta = (id, a, b) => {
    const el = $(id);
    if (!b) { el.textContent = '—'; el.className = 'val'; return; }
    const p = Math.round((a / b - 1) * 100);
    el.textContent = (p > 0 ? '+' : '') + p + '%';
    el.className = 'val ' + (p >= 0 ? 'yoy-up' : 'yoy-down');
  };
  $('yoyTodayLbl').textContent = live ? 'Today so far' : yoyDate(V.day, false);
  $('yoyToday').textContent = yoyMoney(today.sales);
  $('yoyTodaySub').textContent = yoyInt(today.orders) + ' orders · ' + yoyInt(today.units) + ' units' + (live ? ' · data to ' + yoyTime(V.asOf) + ' PT' : ' · whole day');
  delta('yoyVsLy', today.sales, lySame.sales);
  $('yoyVsLySub').textContent = yoyDate(V.ly) + upTo + ': ' + yoyMoney(lySame.sales) + ' · ' + yoyInt(lySame.orders) + ' orders';
  delta('yoyVsLw', today.sales, lwSame.sales);
  $('yoyVsLwSub').textContent = yoyDate(V.lw, false) + upTo + ': ' + yoyMoney(lwSame.sales) + ' · ' + yoyInt(lwSame.orders) + ' orders';
  $('yoyLyDay').textContent = yoyMoney(lyDay.sales);
  $('yoyLyDaySub').textContent = (lyDay.sales ? Math.round(today.sales / lyDay.sales * 100) + '% of it reached · ' : '') + yoyInt(lyDay.orders) + ' orders';
  if (live && lySame.sales > 0) {
    $('yoyPace').textContent = yoyMoney(today.sales * lyDay.sales / lySame.sales);
    $('yoyPaceSub').textContent = 'if the rest of today follows ' + yoyDate(V.ly, false) + '’s shape';
  } else {
    $('yoyPace').textContent = live ? '—' : yoyMoney(today.sales);
    $('yoyPaceSub').textContent = live ? 'needs last year’s sales by this hour' : 'the day is closed';
  }
  // Average order: sales ÷ orders, against last year by the same time.
  const aov = r => (r.orders ? r.sales / r.orders : 0);
  $('yoyAov').textContent = today.orders ? '$' + aov(today).toFixed(2) : '—';
  $('yoyAovSub').textContent = (today.orders ? (today.units / today.orders).toFixed(2) + ' units an order' : '')
    + (lySame.orders ? ' · last year $' + aov(lySame).toFixed(2) : '');
  $('yoySalesNote').textContent = live ? '· Amazon Sales API, to ' + yoyTime(V.asOf) + ' PT' : '· Amazon Sales API, ' + yoyDate(V.day);

  const amzAds = yoyRenderAds(V, today);
  yoyRenderShop(V, live, frac, today, lySame, lwSame, amzAds);
  yoyRenderPeriod(V, today, lySame, lyDay);

  // --- legends ---
  $('yoyLgNow').textContent = live ? 'Today' : yoyDate(V.day);
  $('yoyLgLy').textContent = yoyDate(V.ly) + ' (last year)';
  $('yoyLgLw').textContent = yoyDate(V.lw, false) + ' (last week)';

  // --- charts ---
  const hours = [...Array(24).keys()];
  yoyBars($('yoyHours'), hours.map(yoyHour), [
    { vals: hours.map(h => V.now[h] ? V.now[h].sales : null), fill: 'var(--yoy-now)', name: live ? 'Today' : yoyDate(V.day, false), part: live ? n - 1 : -1 },
    { vals: hours.map(h => V.last[h] ? V.last[h].sales : 0), fill: 'var(--yoy-ly)', name: yoyDate(V.ly) },
  ], { vals: hours.map(h => V.lastWeek[h] ? V.lastWeek[h].sales : 0), name: yoyDate(V.lw, false) }, h => yoyHour(h) + '–' + yoyHour((h + 1) % 24));

  const cum = rows => { let t = 0; return hours.map(h => (rows[h] ? (t += rows[h].sales) : null)); };
  const cNow = cum(V.now), cLy = cum(V.last), cLw = cum(V.lastWeek);
  yoyLines($('yoyCum'), hours.map(yoyHour), [
    { vals: cLy, stroke: 'var(--yoy-ly)', name: yoyDate(V.ly), end: yoyK(lyDay.sales) + ' last year' },
    { vals: cLw, stroke: 'var(--yoy-lw)', dash: true, name: yoyDate(V.lw, false), end: yoyK(cLw.filter(v => v != null).pop() || 0) + ' last week' },
    { vals: cNow, stroke: 'var(--yoy-now)', width: 3, name: live ? 'Today' : yoyDate(V.day, false), end: yoyK(today.sales) + (live ? ' so far' : '') },
  ]);

  yoyTable(V, live, n);
}

/* ---------- the advertising row: Sponsored Products + Brands + Display from the Ads API, stored by the backend ----------
 * YOY[brand].ads = { at, types, days: { 'YYYY-MM-DD': { impressions, clicks, spend, orders, sales } }, err } and
 * YOY[brand].week = the 7 days to the day on view, by day, from the Sales API (Pricing-API/SalesLive.gs).
 * The big figure is the day on view; under it, yesterday and the 7 days (Ravi, 2026-11-20: "do for this day and this week").
 * Amazon's ad figures for today run behind the sales figures, so TACoS today reads a little low early in the day. */
function yoyRenderAds(V, today) {
  const ads = V.keys.map(k => YOY[k].ads).filter(a => a && a.days);
  const Z = () => ({ impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 });
  const sum = d => { let t = null; ads.forEach(a => { const r = a.days[d]; if (r) { t = t || Z(); for (const f in t) t[f] += Number(r[f]) || 0; } }); return t; };
  const salesOn = {};                                            // date → all Amazon sales (Sales API), brands on view
  V.keys.forEach(k => (YOY[k].week || []).forEach(r => { const d = String(r.t).slice(0, 10); salesOn[d] = (salesOn[d] || 0) + (r.sales || 0); }));
  salesOn[V.day] = today.sales;                                  // the hourly figure is the freshest for the day on view
  const yd = sdShift(V.day, -1), week = [...Array(7).keys()].map(i => sdShift(V.day, i - 6));
  const A = sum(V.day), Y = sum(yd);
  const Wk = week.reduce((t, d) => { const r = sum(d); if (r) for (const f in t) t[f] += r[f]; return t; }, Z());
  const wkSales = week.reduce((t, d) => t + (salesOn[d] || 0), 0), haveWk = week.every(d => salesOn[d] != null);
  const ids = ['yoyAdSpend', 'yoyTacos', 'yoyAcos', 'yoyAdSales', 'yoyOrganic', 'yoyClicks'];
  const pc = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
  if (!A) {
    ids.forEach(id => { $(id).textContent = '—'; $(id + 'Sub').textContent = ''; });
    const err = V.keys.map(k => YOY[k].ads && YOY[k].ads.err).filter(Boolean)[0];
    $('yoyAdsNote').textContent = err ? '· could not read the ad report (' + err + ')' : '· waiting for Amazon’s ad report (it can take up to an hour)';
    $('yoyAdSpendSub').textContent = 'waiting for Amazon’s ad report';
    return null;
  }
  const at = ads.map(a => a.at).filter(Boolean).sort()[0];
  const types = [...new Set(ads.flatMap(a => a.types || ['Products']))];
  $('yoyAdsNote').textContent = '· Sponsored ' + types.join(' + ') + ', Amazon Ads API' + (at ? ' · report asked at ' + yoyTime(at) + ' PT' : '');
  const sub = (y, w) => [Y ? 'Yesterday ' + y : '', haveWk || w !== null ? '7 days ' + w : ''].filter(Boolean).join(' · ');
  $('yoyAdSpend').textContent = yoyMoney(A.spend);
  $('yoyAdSpendSub').textContent = sub(Y && yoyMoney(Y.spend), yoyMoney(Wk.spend));
  $('yoyTacos').textContent = pc(A.spend, today.sales);
  $('yoyTacosSub').textContent = sub(Y && pc(Y.spend, salesOn[yd]), haveWk ? pc(Wk.spend, wkSales) : null) || 'ad spend ÷ all sales';
  $('yoyAcos').textContent = pc(A.spend, A.sales);
  $('yoyAcosSub').textContent = (A.spend ? 'ROAS ' + (A.sales / A.spend).toFixed(2) + ' · ' : '') + sub(Y && pc(Y.spend, Y.sales), pc(Wk.spend, Wk.sales));
  $('yoyAdSales').textContent = yoyMoney(A.sales);
  $('yoyAdSalesSub').textContent = yoyInt(A.orders) + ' ad orders · ' + pc(A.sales, today.sales) + ' of all sales · 7 days ' + yoyMoney(Wk.sales);
  const org = Math.max(0, today.sales - A.sales);
  $('yoyOrganic').textContent = yoyMoney(org);
  $('yoyOrganicSub').textContent = pc(org, today.sales) + ' of all sales' + (haveWk ? ' · 7 days ' + pc(Math.max(0, wkSales - Wk.sales), wkSales) : '');
  $('yoyClicks').textContent = yoyInt(A.clicks);
  $('yoyClicksSub').textContent = (A.clicks ? 'CPC $' + (A.spend / A.clicks).toFixed(2) : 'CPC —') + ' · CTR ' + pc(A.clicks, A.impressions) + ' · 7 days CPC ' + (Wk.clicks ? '$' + (Wk.spend / Wk.clicks).toFixed(2) : '—');
  return A;
}

/* ---------- Shopify & Meta, then all channels (Ravi, 2026-11-20) ----------
 * YOY[brand].shop = { now, last, lastWeek } — the brand's Shopify store by PACIFIC hour (Pricing-API/SalesLive.gs liveShop_),
 * compared "by the same time" exactly as Amazon is. YOY[brand].meta = { configured, days:{date:{spend, clicks, impressions,
 * purchases, value}} } — { configured:false } until META_TOKEN and the ad account are in Script Properties.
 * amzAds = the Amazon ad totals for the day (yoyRenderAds), or null while that report is pending. */
function yoyRenderShop(V, live, frac, amzToday, amzLySame, amzLwSame, amzAds) {
  const pc = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
  const set = (id, v, sub, cls) => { $(id).textContent = v; $(id).className = 'val' + (cls ? ' ' + cls : ''); $(id + 'Sub').textContent = sub || ''; };
  const chg = (a, b) => { if (!b) return ['—', '']; const p = Math.round((a / b - 1) * 100); return [(p > 0 ? '+' : '') + p + '%', p >= 0 ? 'yoy-up' : 'yoy-down']; };
  const shops = V.keys.map(k => YOY[k].shop).filter(s => s && s.now);
  const errs = V.keys.map(k => YOY[k].shop && YOY[k].shop.err).filter(Boolean);
  const merge = f => { const lists = shops.map(s => s[f] || []); const n = Math.max(0, ...lists.map(l => l.length)); return [...Array(n).keys()].map(i => lists.reduce((t, l) => yoyAdd(t, l[i]), yoyZero())); };
  const now = merge('now'), last = merge('last'), lw = merge('lastWeek'), n = now.length;
  const sameTime = rows => { if (!live) return rows.reduce(yoyAdd, yoyZero()); let t = yoyZero(); rows.forEach((r, i) => { if (i < n - 1) t = yoyAdd(t, r); else if (i === n - 1) t = yoyAdd(t, yoyScale(r, frac)); }); return t; };
  // Shopify's store opened in January 2026 (first sale 28 Dec 2025): last year IS $0, and is shown as $0 — the change is
  // then given in dollars, since a percentage of nothing means nothing (Ravi, 2026-11-20: "compare last year by 0").
  const sh = now.reduce(yoyAdd, yoyZero()), shLy = sameTime(last), shLw = sameTime(lw), lwDay = lw.reduce(yoyAdd, yoyZero());
  const upTo = live ? ' by ' + yoyTime(V.asOf) : '';
  const m4 = merge('fourWk'), sh4 = sameTime(m4), m4Day = shops.map(s => s.fourWkDay).filter(Boolean)[0];
  const vsZero = (a, b) => (b > 0 ? chg(a, b) : [(a >= 0 ? '+' : '−') + yoyMoney(Math.abs(a - b)), a > b ? 'yoy-up' : '']);
  if (shops.length) {
    set('yoyShToday', yoyMoney(sh.sales), yoyInt(sh.orders) + ' orders · ' + yoyInt(sh.units) + ' units');
    const [a, ac] = vsZero(sh.sales, shLy.sales);
    set('yoyShVsLy', a, yoyDate(V.ly) + upTo + ': ' + yoyMoney(shLy.sales) + (shLy.sales ? ' · ' + yoyInt(shLy.orders) + ' orders' : ' · the store opened in January 2026'), ac);
    const [b, bc] = chg(sh.sales, shLw.sales); set('yoyShVsLw', b, yoyDate(V.lw, false) + upTo + ': ' + yoyMoney(shLw.sales) + ' · ' + yoyInt(shLw.orders) + ' orders', bc);
    if (m4Day) { const [d, dc] = chg(sh.sales, sh4.sales); set('yoySh4w', d, yoyDate(m4Day, false) + upTo + ': ' + yoyMoney(sh4.sales) + ' · ' + yoyInt(sh4.orders) + ' orders', dc); }
    else set('yoySh4w', '—', 'waiting for the backend update');
    if (live && shLw.sales > 0) set('yoyShPace', yoyMoney(sh.sales * lwDay.sales / shLw.sales), 'if the rest of today follows ' + yoyDate(V.lw, false) + '’s shape · that day ' + yoyMoney(lwDay.sales));
    else set('yoyShPace', live ? '—' : yoyMoney(sh.sales), live ? 'needs last week’s sales by this hour' : 'the day is closed');
    set('yoyShAov', sh.orders ? '$' + (sh.sales / sh.orders).toFixed(2) : '—', (sh.orders ? (sh.units / sh.orders).toFixed(2) + ' units an order' : '') + (shLw.orders ? ' · last week $' + (shLw.sales / shLw.orders).toFixed(2) : ''));
  } else ['yoyShToday', 'yoyShVsLy', 'yoyShVsLw', 'yoySh4w', 'yoyShPace', 'yoyShAov'].forEach(id => set(id, '—', errs[0] ? 'could not read Shopify' : 'waiting for the backend update'));
  // --- Shopify charts (2026-11-20): today by the hour in Shopify green beside last week, four weeks ago dashed; and the
  // running totals. Same helpers as Amazon's charts. ---
  if (shops.length && $('yoyShHours')) {
    const hours = [...Array(24).keys()], tip = h => yoyHour(h) + '–' + yoyHour((h + 1) % 24);
    const lwName = yoyDate(V.lw, false), m4Name = m4Day ? yoyDate(m4Day, false) : '4 weeks ago';
    $('yoyShLgNow').textContent = live ? 'Today' : yoyDate(V.day, false); $('yoyShLgLw').textContent = lwName + ' (last week)'; $('yoyShLg4w').textContent = m4Name + ' (4 weeks ago)';
    yoyBars($('yoyShHours'), hours.map(yoyHour), [
      { vals: hours.map(h => (now[h] ? now[h].sales : null)), fill: '#5E8E3E', name: live ? 'Today' : yoyDate(V.day, false), part: live ? n - 1 : -1 },
      { vals: hours.map(h => (lw[h] ? lw[h].sales : 0)), fill: '#C3DE96', name: lwName },
    ], m4.length ? { vals: hours.map(h => (m4[h] ? m4[h].sales : 0)), name: m4Name, stroke: '#8A94A3' } : null, tip);
    const cum = rows => { let t = 0; return hours.map(h => (rows[h] ? (t += rows[h].sales) : null)); };
    const cLw = cum(lw), c4 = cum(m4);
    yoyLines($('yoyShCum'), hours.map(yoyHour), [
      { vals: cLw, stroke: '#A8CF6A', name: lwName, end: yoyK(cLw.filter(v => v != null).pop() || 0) + ' last week' },
      ...(m4.length ? [{ vals: c4, stroke: '#8A94A3', dash: true, name: m4Name, end: yoyK(c4.filter(v => v != null).pop() || 0) + ' 4 wks ago' }] : []),
      { vals: cum(now), stroke: '#5E8E3E', width: 3, name: live ? 'Today' : yoyDate(V.day, false), end: yoyK(sh.sales) + (live ? ' so far' : '') },
    ]);
  }
  // --- Meta ---
  const metas = V.keys.map(k => YOY[k].meta).filter(Boolean);
  const metaOn = metas.filter(m => m.configured && m.days);
  let M = null;
  metaOn.forEach(m => { const r = m.days[V.day]; if (r) { M = M || { spend: 0, clicks: 0, impressions: 0, purchases: 0, value: 0 }; for (const f in M) M[f] += Number(r[f]) || 0; } });
  const metaErr = metas.map(m => m.err).filter(Boolean)[0];
  if (M) {
    set('yoyMetaSpend', yoyMoney(M.spend), yoyInt(M.clicks) + ' clicks · CPC ' + (M.clicks ? '$' + (M.spend / M.clicks).toFixed(2) : '—'));
    // Only the stores whose Meta account is connected: one brand's spend against both stores' sales would flatter it.
    const shMeta = V.keys.filter(k => YOY[k].meta && YOY[k].meta.configured && YOY[k].meta.days)
      .reduce((t, k) => t + ((YOY[k].shop || {}).now || []).reduce((s, r) => s + (r.sales || 0), 0), 0);
    set('yoyMetaRoas', M.spend ? (shMeta / M.spend).toFixed(2) : '—', 'Shopify sales ÷ Meta spend · Meta counts ' + yoyInt(M.purchases) + ' purchases, ' + yoyMoney(M.value));
    set('yoyShTacos', pc(M.spend, shMeta), 'Meta spend ÷ Shopify sales');
  } else {
    const why = metaErr ? 'Meta: ' + metaErr : metas.length && metas.every(m => m.configured === false) ? 'Not connected yet: add META_TOKEN and META_AD_ACCOUNT in the backend’s Script Properties' : 'waiting for Meta';
    set('yoyMetaSpend', '—', why); set('yoyMetaRoas', '—', ''); set('yoyShTacos', '—', '');
  }
  $('yoyShopNote').textContent = 'Shopify Admin API · Pacific day' + (M ? ' · Meta Marketing API (ad account’s own day)' : '') + (errs.length ? ' · ' + errs.join(' · ') : '');
  // --- the overview: both channels ---
  const allSales = amzToday.sales + sh.sales, allLw = amzLwSame.sales + shLw.sales, allLy = amzLySame.sales + shLy.sales;
  set('yoyAllSales', yoyMoney(allSales), 'Amazon ' + yoyMoney(amzToday.sales) + ' · Shopify ' + yoyMoney(sh.sales));
  const [e, ec] = chg(allSales, allLy);
  set('yoyAllVsLy', e, yoyDate(V.ly) + upTo + ': ' + yoyMoney(allLy) + (shLy.sales ? '' : ' (Shopify $0)'), ec);
  const [c, cc] = chg(allSales, allLw); set('yoyAllVsLw', c, yoyDate(V.lw, false) + upTo + ': ' + yoyMoney(allLw), cc);
  const spend = (amzAds ? amzAds.spend : 0) + (M ? M.spend : 0);
  const parts = [amzAds ? 'Amazon ' + yoyMoney(amzAds.spend) : 'Amazon pending', M ? 'Meta ' + yoyMoney(M.spend) : 'Meta not connected'];
  set('yoyAllSpend', amzAds || M ? yoyMoney(spend) : '—', parts.join(' · '));
  set('yoyAllTacos', amzAds || M ? pc(spend, allSales) : '—', amzAds && M ? 'all ads ÷ all sales' : 'so far without ' + (amzAds ? 'Meta' : 'Amazon ads'));
  const amzPct = allSales > 0 ? amzToday.sales / allSales * 100 : 0;
  set('yoyAllAmz', allSales > 0 ? Math.round(amzPct) + ' / ' + Math.round(100 - amzPct) : '—', 'Amazon ' + pc(amzToday.sales, allSales) + ' · Shopify ' + pc(sh.sales, allSales));
  $('yoySplitAmz').style.width = amzPct + '%'; $('yoySplitShop').style.width = (allSales > 0 ? 100 - amzPct : 0) + '%';
}

/* ---------- WEEK / MONTH / QUARTER / YEAR to date (Ravi, 2026-11-20) — the same as live.html's renderPeriod ----------
 * YOY_HIST = ?live=hist → { through, d: { SP, CPC, SHOP: { date: [sales, units, orders] } }, ads: { SP, CPC: { date: [impr,
 * clicks, spend, orders, sales] } } } — the nightly history (Pricing-API/SalesLive.gs liveHist_), read once and again every
 * ten minutes while a period is on view. A period to date = its finished days from that history (Amazon days it has not
 * reached yet come from the live week) + today's live figures. Last year: week = the same weekdays 364 days back; month,
 * quarter and year = the same calendar dates; last year's "today" is scaled to the same moment by last year's Amazon shape.
 * Shopify history is Ridhi's store (first sale 28 Dec 2025, so last year is $0). Ad spend: the live report (Products + Brands
 * + Display) where it reaches, the nightly Sponsored Products figure before; TACoS only over the days that have ad figures. */
let YOY_PERIOD = 'day';
// Named YOY_HIST*, not YOY_H*: YOY_H is the charts' height further down this file.
let YOY_HIST = null, YOY_HIST_AT = 0, YOY_HIST_BUSY = false, YOY_HIST_ERR = '';
// At most one read per ten minutes, failed or not — a failing read must not be retried on every redraw.
async function yoyLoadHist(force) {
  if (YOY_HIST_BUSY || (!force && YOY_HIST_AT && Date.now() - YOY_HIST_AT < 10 * 60 * 1000)) return;
  YOY_HIST_BUSY = true; YOY_HIST_AT = Date.now();
  try { YOY_HIST = await baCall({ live: 'hist', day: $('yoyDay').value || sdToday() }); YOY_HIST_ERR = ''; }
  catch (e) { YOY_HIST_ERR = String(e.message || e); }
  finally { YOY_HIST_BUSY = false; }
  yoyRender();
}
function yoyCard(cls, k, v, sub, vcls, title) {
  return `<div class="sd-card ${cls}"${title ? ` title="${title}"` : ''}><div class="lbl">${k}</div><div class="val${vcls ? ' ' + vcls : ''}">${v}</div><div class="sub">${sub || ''}</div></div>`;
}
function yoyRenderPeriod(V, tot, lySame, lyDay) {
  $('paneYoy').dataset.period = YOY_PERIOD;
  if (YOY_PERIOD === 'day') return;
  const H = YOY_HIST, amzK = V.keys, T = V.day;
  yoyLoadHist();                                     // a no-op unless ten minutes have passed
  if (YOY_PERIOD === 'events') { if (H && H.d) yoyRenderEvents(V, tot, lySame, lyDay, H); else { $('yoyPnote').textContent = YOY_HIST_ERR ? 'Could not read the history: ' + YOY_HIST_ERR : 'Reading the history…'; $('yoyEvents').innerHTML = ''; } return; }
  if (!H || !H.d) { $('yoyPnote').textContent = YOY_HIST_ERR ? 'Could not read the history for the period: ' + YOY_HIST_ERR : 'Reading the history…'; ['yoyPAll', 'yoyPAmz', 'yoyPShop'].forEach(id => { $(id).innerHTML = ''; }); return; }
  const sh = (d, n) => sdShift(d, n);
  const lyDate = d => { const y = Number(d.slice(0, 4)) - 1, md = d.slice(5) === '02-29' ? '02-28' : d.slice(5); return y + '-' + md; };
  const dow = (new Date(T + 'T12:00:00Z').getUTCDay() + 6) % 7, mo = Number(T.slice(5, 7));
  const start = { week: sh(T, -dow), month: T.slice(0, 8) + '01', quarter: T.slice(0, 5) + String(Math.floor((mo - 1) / 3) * 3 + 1).padStart(2, '0') + '-01', year: T.slice(0, 4) + '-01-01' }[YOY_PERIOD];
  const lyOf = d => (YOY_PERIOD === 'week' ? sh(d, -364) : lyDate(d));
  const days = []; for (let d = start; d < T; d = sh(d, 1)) days.push(d);
  const lyFrac = V.day === sdToday() && lyDay.sales > 0 ? lySame.sales / lyDay.sales : 1;
  const Z = () => ({ sales: 0, units: 0, orders: 0 });
  const addRow = (t, r, f) => { if (r) { t.sales += (r[0] || 0) * (f || 1); t.units += (r[1] || 0) * (f || 1); t.orders += (r[2] || 0) * (f || 1); } return t; };
  const weekRow = (k, d) => { const r = (YOY[k].week || []).find(x => String(x.t).slice(0, 10) === d); return r ? [r.sales, r.units, r.orders] : null; };
  const best = { amz: null, shop: null }, byDay = {};
  const amz = Z(), amzLy = Z();
  days.forEach(d => { const t = Z(); amzK.forEach(k => addRow(t, (H.d[k] || {})[d] || weekRow(k, d))); addRow(amz, [t.sales, t.units, t.orders]); byDay[d] = { a: t.sales, s: 0 }; if (!best.amz || t.sales > best.amz[1]) best.amz = [d, t.sales]; });
  amz.sales += tot.sales; amz.units += tot.units; amz.orders += tot.orders; byDay[T] = { a: tot.sales, s: 0 };
  days.forEach(d => amzK.forEach(k => addRow(amzLy, (H.d[k] || {})[lyOf(d)])));
  amzK.forEach(k => addRow(amzLy, (H.d[k] || {})[lyOf(T)], lyFrac));
  const shopOn = amzK.includes('SP'), shp = Z(), shpLy = Z();
  if (shopOn) {
    days.forEach(d => { const r = (H.d.SHOP || {})[d]; addRow(shp, r); if (r) byDay[d].s = r[0]; if (r && (!best.shop || r[0] > best.shop[1])) best.shop = [d, r[0]]; });
    ((YOY.SP.shop || {}).now || []).forEach(r => { shp.sales += r.sales || 0; shp.units += r.units || 0; shp.orders += r.orders || 0; byDay[T].s += r.sales || 0; });
    days.forEach(d => addRow(shpLy, (H.d.SHOP || {})[lyOf(d)]));
    addRow(shpLy, (H.d.SHOP || {})[lyOf(T)], lyFrac);
  }
  let spend = 0, adFrom = '';
  days.concat([T]).forEach(d => amzK.forEach(k => {
    const live = (((YOY[k].ads || {}).days) || {})[d], old = ((H.ads || {})[k] || {})[d];
    const s = live ? live.spend : old ? old[2] : null;
    if (s != null) { spend += Number(s) || 0; if (!adFrom || d < adFrom) adFrom = d; }
  }));
  let adA = 0, adS = 0; Object.keys(byDay).forEach(d => { if (adFrom && d >= adFrom) { adA += byDay[d].a; adS += byDay[d].s; } });
  const all = amz.sales + shp.sales, allLy = amzLy.sales + shpLy.sales, aPct = all > 0 ? amz.sales / all * 100 : 0;
  const NAME = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }[YOY_PERIOD];
  const range = (a, b) => yoyDate(a, false) + ' – ' + yoyDate(b);
  $('yoyPnote').innerHTML = `<b>${NAME} to date</b> · ${range(start, T)} against ${range(lyOf(start), lyOf(T))}`
    + (V.day === sdToday() ? ` · today to ${yoyTime(V.asOf)} PT, last year to the same time` : '')
    + ` · history to ${H.through ? yoyDate(H.through, false) : '—'}` + (shopOn ? '' : ' · Shopify history is kept for Ridhi’s store only');
  const pc = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
  const chg = (a, b) => { if (!b) return ['—', '']; const p = Math.round((a / b - 1) * 100); return [(p > 0 ? '+' : '') + p + '%', p >= 0 ? 'yoy-up' : 'yoy-down']; };
  const vsZero = (a, b) => (b > 0 ? chg(a, b) : ['+' + yoyMoney(a), a > 0 ? 'yoy-up' : '']);
  const aov = r => (r.orders ? '$' + (r.sales / r.orders).toFixed(2) : '—');
  const adNote = adFrom && adFrom > start ? ' · ads from ' + yoyDate(adFrom, false) : '';
  const [cA, kA] = chg(all, allLy), [cZ, kZ] = chg(amz.sales, amzLy.sales), [cS, kS] = vsZero(shp.sales, shpLy.sales);
  $('yoyPAll').innerHTML =
    yoyCard('sd-b-indigo', NAME + ' sales', yoyMoney(all), 'Amazon ' + yoyMoney(amz.sales) + ' · Shopify ' + yoyMoney(shp.sales))
    + yoyCard('sd-b-orange', 'vs last year', cA, 'last year ' + yoyMoney(allLy) + (shpLy.sales ? '' : ' (Shopify $0)'), kA)
    + yoyCard('sd-b-teal', 'Orders', yoyInt(amz.orders + shp.orders), yoyInt(amz.units + shp.units) + ' units')
    + yoyCard('yoy-b-spend', 'Amazon ad spend', spend ? yoyMoney(spend) : '—', 'Meta not connected' + adNote)
    + yoyCard('yoy-b-tacos', 'TACoS', spend ? pc(spend, adA + adS) : '—', 'Amazon ads ÷ all sales' + adNote)
    + yoyCard('yoy-b-adsales', 'Channel split', all > 0 ? Math.round(aPct) + ' / ' + Math.round(100 - aPct) : '—',
      `<span class="yoy-split" style="display:flex;margin:4px 0 8px"><i style="width:${aPct}%"></i><i style="width:${all > 0 ? 100 - aPct : 0}%"></i></span>Amazon ${pc(amz.sales, all)} · Shopify ${pc(shp.sales, all)}`);
  $('yoyPAmz').innerHTML =
    yoyCard('sd-b-cyan', NAME + ' sales', yoyMoney(amz.sales), yoyInt(amz.orders) + ' orders · ' + yoyInt(amz.units) + ' units')
    + yoyCard('sd-b-orange', 'vs last year', cZ, 'last year ' + yoyMoney(amzLy.sales) + ' · ' + yoyInt(amzLy.orders) + ' orders', kZ)
    + yoyCard('sd-b-pink', 'Average order', aov(amz), amzLy.orders ? 'last year ' + aov(amzLy) : '')
    + yoyCard('yoy-b-spend', 'Ad spend', spend ? yoyMoney(spend) : '—', adNote ? adNote.slice(3) : 'Products + Brands + Display')
    + yoyCard('yoy-b-tacos', 'TACoS', spend ? pc(spend, adA) : '—', 'ad spend ÷ Amazon sales' + adNote)
    + yoyCard('sd-b-indigo', 'Best day', best.amz ? yoyMoney(best.amz[1]) : '—', best.amz ? yoyDate(best.amz[0], false) : 'today is the first day');
  $('yoyPShop').innerHTML = shopOn
    ? yoyCard('sd-b-cyan', NAME + ' sales', yoyMoney(shp.sales), yoyInt(shp.orders) + ' orders · ' + yoyInt(shp.units) + ' units')
      + yoyCard('sd-b-orange', 'vs last year', cS, 'last year ' + yoyMoney(shpLy.sales) + (shpLy.sales ? '' : ' · the store opened in January 2026'), kS)
      + yoyCard('sd-b-pink', 'Average order', aov(shp), '')
      + yoyCard('yoy-b-organic', 'Share of all sales', pc(shp.sales, all), 'Shopify ÷ (Amazon + Shopify)')
      + yoyCard('sd-b-teal', 'Orders a day', (shp.orders / (days.length + 1)).toFixed(1), 'over ' + (days.length + 1) + ' day' + (days.length ? 's' : '') + ', today included')
      + yoyCard('sd-b-indigo', 'Best day', best.shop ? yoyMoney(best.shop[1]) : '—', best.shop ? yoyDate(best.shop[0], false) : 'today is the first day')
    : yoyCard('sd-b-cyan', 'Shopify', '—', 'Shopify history is kept for Ridhi’s store only — pick Ridhi or Ridhi + CPC');
}

/* ---------- EVENTS (Ravi, 2026-11-20: "a literal Events tab — what the events are, and how we did") ----------
 * The same as live.html's renderEvents. Amazon's US shopping events, this year and last; to add next year's, one more line in
 * d, by year, [first day, last day] in Pacific dates. Each card: what the event is; sales on its days (Amazon + Shopify, from
 * the nightly history and today's live figures); against last year's event (a running one: the same number of days, the last
 * cut to the same moment); against our normal days (the 14 before it); ad spend and TACoS where ad figures reach; the best
 * day; and the days side by side with last year's. Shopify's first sale was 28 Dec 2025, so 2025 events are Amazon only. */
const YOY_EVENTS = [
  { name: 'Big Spring Sale', what: '7 days · open to all shoppers, with Prime-exclusive deals', d: { 2025: ['2025-03-25', '2025-03-31'], 2026: ['2026-03-25', '2026-03-31'] } },
  { name: 'Prime Day', what: '4 days · Prime members only', d: { 2025: ['2025-07-08', '2025-07-11'], 2026: ['2026-06-23', '2026-06-26'] } },
  { name: 'Prime Big Deal Days', what: '48 hours · Prime members only, early holiday deals', d: { 2025: ['2025-10-07', '2025-10-08'], 2026: ['2026-10-06', '2026-10-07'] } },
  { name: 'Black Friday Week & Cyber Monday', what: '12 days · Thanksgiving 26 Nov, Black Friday 27 Nov, Cyber Monday 30 Nov', d: { 2025: ['2025-11-20', '2025-12-01'], 2026: ['2026-11-19', '2026-11-30'] } },
];
function yoyRenderEvents(V, tot, lySame, lyDay, H) {
  const T = V.day, Y = Number(T.slice(0, 4)), amzK = V.keys, view = $('paneYoy').dataset.view || 'both', live = T === sdToday();
  const lyFrac = live && lyDay.sales > 0 ? lySame.sales / lyDay.sales : 1;
  const span = (a, b) => { const r = []; for (let d = a; d <= b; d = sdShift(d, 1)) r.push(d); return r; };
  const shopOn = amzK.includes('SP') && view !== 'amz', amzOn = view !== 'shop';
  const shNow = (YOY.SP && YOY.SP.shop && YOY.SP.shop.now) || [];
  const shopToday = shNow.reduce((t, r) => t + (r.sales || 0), 0), shopTodayO = shNow.reduce((t, r) => t + (r.orders || 0), 0);
  const pc = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
  const chg = (a, b) => { if (!b) return ['—', '']; const p = Math.round((a / b - 1) * 100); return [(p > 0 ? '+' : '') + p + '%', p >= 0 ? 'yoy-up' : 'yoy-down']; };
  const day = d => {
    let a = 0, sp = 0, o = 0;
    if (amzOn) {
      if (d === T) { a = tot.sales; o += tot.orders; }
      else amzK.forEach(k => {
        let r = (H.d[k] || {})[d];
        if (!r) { const w = (YOY[k].week || []).find(x => String(x.t).slice(0, 10) === d); if (w) r = [w.sales, w.units, w.orders]; }
        if (r) { a += r[0]; o += r[2]; }
      });
    }
    if (shopOn) { if (d === T) { sp = shopToday; o += shopTodayO; } else { const r = (H.d.SHOP || {})[d]; if (r) { sp = r[0]; o += r[2]; } } }
    return { s: a + sp, o, a, sp };
  };
  const adOn = d => { let s = null; amzK.forEach(k => { const lv = ((YOY[k].ads || {}).days || {})[d], old = ((H.ads || {})[k] || {})[d]; const v = lv ? lv.spend : old ? old[2] : null; if (v != null) s = (s || 0) + Number(v); }); return s; };
  const sum = ds => ds.reduce((t, d) => { const x = day(d); t.s += x.s; t.o += x.o; t.a += x.a; t.sp += x.sp; return t; }, { s: 0, o: 0, a: 0, sp: 0 });
  const cards = YOY_EVENTS.map(ev => {
    const [a, b] = ev.d[Y] || [], [la, lb] = ev.d[Y - 1] || [];
    if (!a) return null;
    const all = span(a, b), n = all.length, done = all.filter(d => d <= T), k = done.length;
    const state = T < a ? 'soon' : T > b ? 'done' : 'live';
    const ly = la ? span(la, lb) : [], lyCmp = state === 'live' ? ly.slice(0, k) : ly;
    const ty = sum(done), lyT = sum(lyCmp), lyAll = sum(ly);
    if (state === 'live' && lyCmp.length === k && k) { const l = day(lyCmp[k - 1]); lyT.s -= l.s * (1 - lyFrac); lyT.o -= l.o * (1 - lyFrac); }
    const base = sum(span(sdShift(a, -14), sdShift(a, -1))), baseDay = base.s / 14, perDay = k ? ty.s / k : 0;
    let spend = 0, adDays = 0; done.forEach(d => { const v = adOn(d); if (v != null) { spend += v; adDays++; } });
    const best = done.map(d => [d, day(d).s]).sort((x, y) => y[1] - x[1])[0];
    const pill = state === 'live' ? `Live · day ${k} of ${n}` : state === 'done' ? 'Done' : `In ${Math.round((Date.parse(a) - Date.parse(T)) / 864e5)} days`;
    const [cL, kL] = chg(ty.s, lyT.s);
    const N = (k2, v, s, cls) => `<div class="yoy-ev-n"><div class="k">${k2}</div><div class="v${cls ? ' ' + cls : ''}">${v}</div><div class="s">${s}</div></div>`;
    const nums = state === 'soon'
      ? N('Last year’s event', yoyMoney(lyAll.s), la ? yoyDate(la, false) + ' – ' + yoyDate(lb) : '—')
        + N('Last year per day', ly.length ? yoyMoney(lyAll.s / ly.length) : '—', yoyInt(lyAll.o) + ' orders')
        + N('Our normal day now', yoyMoney(baseDay), 'average of the last 14 days')
        + N('Starts', yoyDate(a, false), n + ' days')
      : N('Sales' + (state === 'live' ? ' so far' : ''), yoyMoney(ty.s), amzOn && shopOn ? 'Amazon ' + yoyK(ty.a) + ' · Shopify ' + yoyK(ty.sp) : yoyInt(ty.o) + ' orders')
        + N('vs last year', cL, (state === 'live' ? 'first ' + k + ' days' : 'whole event') + ': ' + yoyMoney(lyT.s) + (shopOn && !lyT.sp ? ' (Shopify $0)' : ''), kL)
        + N('Lift vs normal', baseDay > 0 && k ? (perDay / baseDay).toFixed(1) + '×' : '—', yoyMoney(perDay) + '/day vs ' + yoyMoney(baseDay) + '/day before')
        + N('Ad spend · TACoS', adDays ? yoyK(spend) : '—', adDays ? 'TACoS ' + pc(spend, ty.a + ty.sp) + (adDays < k ? ' · ' + adDays + ' of ' + k + ' days' : '') : 'no ad figures for these days');
    const W2 = 420, H2 = 96, m = Math.max(n, ly.length), slot = (W2 - 10) / m, bw = Math.min(26, slot / 2.4);
    const vals = all.map(d => (d <= T ? day(d).s : null)), lv = ly.map(d => day(d).s), mx = Math.max(1, ...vals.filter(v => v != null), ...lv);
    let svg = `<svg viewBox="0 0 ${W2} ${H2 + 14}" role="img" aria-label="${ev.name} day by day">`;
    for (let i = 0; i < m; i++) {
      const x = 5 + slot * i + slot / 2, hL = lv[i] != null ? lv[i] / mx * H2 : 0, hT = vals[i] != null ? vals[i] / mx * H2 : 0;
      const tip = (i < n ? yoyDate(all[i], false) : 'Day ' + (i + 1)) + (vals[i] != null ? '\nThis year: ' + yoyMoney(vals[i]) : '') + (lv[i] != null ? '\nLast year (' + yoyDate(ly[i], false) + '): ' + yoyMoney(lv[i]) : '');
      if (lv[i] != null) svg += `<rect class="yoy-bar" x="${x - bw - 1}" y="${H2 - hL}" width="${bw}" height="${hL}" rx="2" fill="var(--yoy-ly)" opacity=".55"/>`;
      if (vals[i] != null) svg += `<rect class="yoy-bar" x="${x + 1}" y="${H2 - hT}" width="${bw}" height="${hT}" rx="2" fill="${state === 'live' && i === k - 1 ? '#E11D48' : 'var(--yoy-now)'}"/>`;
      svg += `<rect x="${x - slot / 2}" y="0" width="${slot}" height="${H2}" fill="transparent" class="yoy-hit" data-tip="${tip}"/>`;
      if (m <= 14 && i < n) svg += `<text x="${x}" y="${H2 + 12}" text-anchor="middle">${yoyDate(all[i], false).split(' ')[1]}</text>`;
    }
    svg += '</svg>';
    return { state, a, html: `<article class="yoy-ev ${state}">
      <div class="yoy-ev-h"><h3>${ev.name}</h3><span class="yoy-ev-pill">${pill}</span></div>
      <p class="yoy-ev-what">${yoyDate(a, false)} – ${yoyDate(b)} · ${ev.what}</p>
      <div class="yoy-ev-nums">${nums}</div>
      ${state === 'soon' ? '' : `<div class="yoy-ev-mini">${svg}</div>`}
      <div class="yoy-ev-foot">${state === 'soon' ? 'Last year’s figures shown until it starts.' : `Best day ${best ? yoyDate(best[0], false) + ' ' + yoyMoney(best[1]) : '—'} · ${yoyInt(ty.o)} orders · blue this year, orange last year (${la ? yoyDate(la, false) + ' – ' + yoyDate(lb, false) : '—'})`}</div>
    </article>` };
  }).filter(Boolean);
  const order = { live: 0, soon: 1, done: 2 };
  cards.sort((x, y) => order[x.state] - order[y.state] || (x.state === 'done' ? y.a.localeCompare(x.a) : x.a.localeCompare(y.a)));
  $('yoyEvents').innerHTML = cards.map(c => c.html).join('');
  $('yoyPnote').innerHTML = `<b>Amazon shopping events ${Y}</b> · ${amzOn && shopOn ? 'Amazon + Shopify' : amzOn ? 'Amazon' : 'Shopify'} · `
    + (live ? `today to ${yoyTime(V.asOf)} PT · ` : '') + `history to ${H.through ? yoyDate(H.through, false) : '—'} · lift = sales a day during the event ÷ the 14 days before it`;
}

/* ---------- SVG helpers ---------- */
const YOY_NS = 'http://www.w3.org/2000/svg';
function yoyEl(tag, attrs, parent, text) {
  const e = document.createElementNS(YOY_NS, tag);
  for (const k in attrs) if (attrs[k] != null && attrs[k] !== '') e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const YOY_W = 960, YOY_H = 280, YOY_L = 54, YOY_RM = 14, YOY_T = 14, YOY_B = 34;
function yoyFrame(host, max) {
  host.innerHTML = '';
  const svg = yoyEl('svg', { viewBox: `0 0 ${YOY_W} ${YOY_H}`, role: 'img' }, host);
  const y = v => YOY_T + (YOY_H - YOY_T - YOY_B) * (1 - v / max);
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    yoyEl('line', { x1: YOY_L, x2: YOY_W - YOY_RM, y1: y(v), y2: y(v), class: 'yoy-grid', 'stroke-width': 1 }, svg);
    yoyEl('text', { x: YOY_L - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg, yoyK(v));
  }
  return { svg, y };
}
function yoyXLabels(svg, labels, xc, every) {
  labels.forEach((l, i) => {
    if (i % every) return;
    const t = yoyEl('text', { x: xc(i), y: YOY_H - YOY_B + 15, 'text-anchor': 'middle' }, svg);
    String(l).split('\n').forEach((part, j) => yoyEl('tspan', { x: xc(i), dy: j ? 12 : 0 }, t, part));
  });
}
// Grouped bars (one group per label), with an optional dashed line on top. A null value draws no bar.
// marks: [{ i, text }] — a shaded band behind slot i with a label at the top (Black Friday, Cyber Monday).
function yoyBars(host, labels, groups, line, tipLabel, marks) {
  const all = groups.flatMap(g => g.vals).concat(line ? line.vals : []).filter(v => v != null);
  const max = yoyNice(Math.max(0, ...all) * (marks && marks.length ? 1.08 : 1));
  const { svg, y } = yoyFrame(host, max);
  const slot = (YOY_W - YOY_L - YOY_RM) / labels.length;
  const bw = Math.min(26, slot * 0.8 / groups.length);
  const xc = i => YOY_L + slot * i + slot / 2;
  (marks || []).forEach(m => {
    yoyEl('rect', { x: xc(m.i) - slot / 2 + 1, y: YOY_T, width: slot - 2, height: y(0) - YOY_T, class: 'yoy-evband', rx: 4 }, svg);
    yoyEl('text', { x: xc(m.i), y: YOY_T + 11, 'text-anchor': 'middle', class: 'yoy-evtxt' }, svg, m.text);
  });
  groups.forEach((g, gi) => g.vals.forEach((v, i) => {
    if (v == null) return;
    const x = xc(i) - (bw * groups.length) / 2 + gi * bw;
    yoyEl('rect', { x: x + 1, y: y(v), width: Math.max(1, bw - 2), height: Math.max(0, y(0) - y(v)), rx: 3, fill: g.fill,
      opacity: i === g.part ? 0.55 : 1, class: 'yoy-bar', style: `animation-delay:${Math.min(i * 14, 400)}ms` }, svg);
  }));
  if (line) {
    const pts = line.vals.map((v, i) => `${xc(i)},${y(v || 0)}`).join(' ');
    yoyEl('polyline', { points: pts, fill: 'none', stroke: line.stroke || 'var(--yoy-lw)', 'stroke-width': 1.8, 'stroke-dasharray': '4 3' }, svg);
  }
  // The hour (or day) running now: a small "now" over its slot.
  const part = groups.map(g => g.part).find(p => p != null && p >= 0);
  if (part != null && part >= 0) yoyEl('text', { x: xc(part), y: YOY_T + 2, 'text-anchor': 'middle', class: 'yoy-now' }, svg, 'now');
  // One hover area per slot, telling every series at once (2026-11-20: "make charts more readable").
  labels.forEach((l, i) => {
    const when = groups[0].dates && groups[0].dates[i] ? yoyDate(groups[0].dates[i], false) : (tipLabel ? tipLabel(i) : String(l).replace('\n', ' '));
    const lines = groups.map(g => (g.vals[i] == null ? null : `${g.name}${g.dates && g.dates[i] && g !== groups[0] ? ' (' + yoyDate(g.dates[i], false) + ')' : ''}: ${yoyMoney(g.vals[i])}${i === g.part ? ' so far' : ''}`)).filter(Boolean);
    if (line && line.vals[i] != null) lines.push(`${line.name}: ${yoyMoney(line.vals[i])}`);
    yoyEl('rect', { x: xc(i) - slot / 2, y: YOY_T, width: slot, height: y(0) - YOY_T, fill: 'transparent', class: 'yoy-hit', 'data-tip': when + '\n' + lines.join('\n') }, svg);
  });
  yoyXLabels(svg, labels, xc, labels.length > 16 ? 2 : 1);
}
// Running-total lines; a null ends a line (today stops at the hour it has reached). Each line is labelled at its end.
function yoyLines(host, labels, lines) {
  const all = lines.flatMap(l => l.vals).filter(v => v != null);
  const max = yoyNice(Math.max(0, ...all));
  const { svg, y } = yoyFrame(host, max);
  const step = (YOY_W - YOY_L - YOY_RM - 110) / (labels.length - 1);
  const xc = i => YOY_L + step * i;
  const ends = [];
  lines.forEach(l => {
    const pts = l.vals.map((v, i) => (v == null ? null : [xc(i), y(v)])).filter(Boolean);
    if (!pts.length) return;
    yoyEl('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', stroke: l.stroke, 'stroke-width': l.width || 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': l.dash ? '5 4' : '', class: l.dash ? '' : 'yoy-draw', pathLength: l.dash ? null : 1000 }, svg);
    const last = pts[pts.length - 1];
    yoyEl('circle', { cx: last[0], cy: last[1], r: 3.5, fill: l.stroke }, svg);
    ends.push({ x: last[0] + 8, y: last[1] + 4, text: l.end, fill: l.stroke });
  });
  // Keep the end labels from sitting on top of each other.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14 && Math.abs(ends[i].x - ends[i - 1].x) < 120) ends[i].y = ends[i - 1].y + 14;
  ends.forEach(e => yoyEl('text', { x: e.x, y: e.y, class: 'yoy-lbl', style: 'fill:' + e.fill }, svg, e.text));
  // One hover area per hour with every line's running total at that hour.
  labels.forEach((l, i) => {
    const rows = lines.filter(x => x.vals[i] != null).map(x => `${x.name}: ${yoyMoney(x.vals[i])}`);
    if (rows.length) yoyEl('rect', { x: xc(i) - step / 2, y: YOY_T, width: step, height: YOY_H - YOY_T - YOY_B, fill: 'transparent', class: 'yoy-hit', 'data-tip': 'By the end of ' + l + '\n' + rows.join('\n') }, svg);
  });
  yoyXLabels(svg, labels, xc, 3);
}

/* ---------- the numbers ---------- */
function yoyTable(V, live, n) {
  const pct = (a, b) => { if (!b) return '—'; const p = Math.round((a / b - 1) * 100); return `<span class="${p >= 0 ? 'yoy-up' : 'yoy-down'}">${p > 0 ? '+' : ''}${p}%</span>`; };
  let tNow = yoyZero(), tLy = yoyZero(), tLw = yoyZero();
  const rows = [...Array(24).keys()].map(h => {
    const a = V.now[h], b = V.last[h] || yoyZero(), c = V.lastWeek[h] || yoyZero();
    tLy = yoyAdd(tLy, b); tLw = yoyAdd(tLw, c);
    if (a) tNow = yoyAdd(tNow, a);
    const part = live && h === n - 1 ? ' <span class="muted">(so far)</span>' : '';
    return `<tr><td>${yoyHour(h)}–${yoyHour((h + 1) % 24)}</td>`
      + `<td>${a ? yoyMoney(a.sales) + part : '<span class="muted">—</span>'}</td><td>${a ? a.orders : ''}</td>`
      + `<td>${yoyMoney(b.sales)}</td><td>${b.orders}</td><td>${a && !part ? pct(a.sales, b.sales) : ''}</td>`
      + `<td>${yoyMoney(c.sales)}</td></tr>`;
  }).join('');
  $('yoyTable').innerHTML = `<table class="yoy-tbl"><thead><tr><th>Hour (PT)</th><th>${live ? 'Today' : yoyDate(V.day, false)}</th><th>Orders</th>`
    + `<th>${yoyDate(V.ly)}</th><th>Orders</th><th>Change</th><th>${yoyDate(V.lw, false)}</th></tr></thead><tbody>${rows}</tbody>`
    + `<tfoot><tr><th>Day</th><th>${yoyMoney(tNow.sales)}</th><th>${yoyInt(tNow.orders)}</th><th>${yoyMoney(tLy.sales)}</th><th>${yoyInt(tLy.orders)}</th>`
    + `<th></th><th>${yoyMoney(tLw.sales)}</th></tr></tfoot></table>`;
}

/* ---------- controls ---------- */
$('yoyRefresh').onclick = () => yoyLoad();
$('yoyDay').onchange = () => { YOY_HIST = null; YOY_HIST_AT = 0; yoyLoad(); };   // the history is cut at the day on view
$('yoyMode').onchange = () => yoyLoad();
$('yoyFrom').onchange = () => yoyLoadRange(false);
$('yoyTo').onchange = () => yoyLoadRange(false);
$('yoyBrand').querySelectorAll('button').forEach(b => b.onclick = () => {
  YOY_BRAND = b.dataset.ch;
  $('yoyBrand').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  try { localStorage.setItem('yoy.brand', YOY_BRAND); } catch (e) { /* no storage */ }
  yoyRender();
  yoyRenderRange();
});
// Chart hover box (2026-11-20): one box that follows the pointer and lists every series at that hour — the browser's own
// title tooltip took a second to appear and showed one bar at a time.
const YOY_TIP = document.createElement('div');
YOY_TIP.className = 'yoy-tip'; YOY_TIP.hidden = true; document.body.appendChild(YOY_TIP);
$('paneYoy').addEventListener('mousemove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { YOY_TIP.hidden = true; return; }
  YOY_TIP.textContent = t.getAttribute('data-tip'); YOY_TIP.hidden = false;
  YOY_TIP.style.left = Math.min(e.clientX + 14, innerWidth - YOY_TIP.offsetWidth - 8) + 'px';
  YOY_TIP.style.top = Math.max(8, e.clientY - YOY_TIP.offsetHeight - 10) + 'px';
});
$('paneYoy').addEventListener('mouseleave', () => { YOY_TIP.hidden = true; });
// A figure that changes on a refresh glows once, so the eye finds what moved. Only a real change: the same text set again is left alone.
new MutationObserver(ms => ms.forEach(m => {
  const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
  if (!el || !el.classList || !el.classList.contains('val') || el.dataset.was === el.textContent) return;
  const first = el.dataset.was == null || el.dataset.was === '—';
  el.dataset.was = el.textContent;
  if (first) return;
  el.classList.remove('yoy-flash'); void el.offsetWidth; el.classList.add('yoy-flash');
})).observe($('paneYoy'), { subtree: true, childList: true, characterData: true });

// The channel toggle (Ravi, 2026-11-20): only shows or hides sections — every figure is still worked out, so switching is instant.
function yoySetChan(v) {
  $('paneYoy').dataset.view = v;
  $('yoyChan').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  if (YOY_PERIOD === 'events' && YOY_KEY) yoyRender();   // the event cards follow the channel picker
}
$('yoyChan').querySelectorAll('button').forEach(b => b.onclick = () => {
  yoySetChan(b.dataset.v);
  try { localStorage.setItem('yoy.chan', b.dataset.v); } catch (e) { /* no storage */ }
});
try { const c = localStorage.getItem('yoy.chan'); yoySetChan(['both', 'amz', 'shop'].includes(c) ? c : 'both'); } catch (e) { yoySetChan('both'); }
// The period picker: Day = today by the hour; the others read the history (once, then every ten minutes) and redraw.
function yoySetPeriod(p) {
  YOY_PERIOD = p; $('paneYoy').dataset.period = p;
  $('yoyPeriod').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.p === p));
  if (YOY_KEY) yoyRender();                          // draws, and reads the history when a period needs it
}
$('yoyPeriod').querySelectorAll('button').forEach(b => b.onclick = () => {
  yoySetPeriod(b.dataset.p);
  try { localStorage.setItem('yoy.period', b.dataset.p); } catch (e) { /* no storage */ }
});
try { const p = localStorage.getItem('yoy.period'); yoySetPeriod(['day', 'week', 'month', 'quarter', 'year', 'events'].includes(p) ? p : 'day'); } catch (e) { yoySetPeriod('day'); }
try {
  const saved = localStorage.getItem('yoy.brand');
  if (saved && $('yoyBrand').querySelector(`[data-ch="${saved}"]`)) {
    YOY_BRAND = saved;
    $('yoyBrand').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.ch === saved));
  }
} catch (e) { /* no storage */ }
