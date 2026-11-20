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
  yoyRenderShop(V, live, frac, today, lySame, amzAds);

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
function yoyRenderShop(V, live, frac, amzToday, amzLySame, amzAds) {
  const pc = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
  const set = (id, v, sub, cls) => { $(id).textContent = v; $(id).className = 'val' + (cls ? ' ' + cls : ''); $(id + 'Sub').textContent = sub || ''; };
  const chg = (a, b) => { if (!b) return ['—', '']; const p = Math.round((a / b - 1) * 100); return [(p > 0 ? '+' : '') + p + '%', p >= 0 ? 'yoy-up' : 'yoy-down']; };
  const shops = V.keys.map(k => YOY[k].shop).filter(s => s && s.now);
  const errs = V.keys.map(k => YOY[k].shop && YOY[k].shop.err).filter(Boolean);
  const merge = f => { const lists = shops.map(s => s[f] || []); const n = Math.max(0, ...lists.map(l => l.length)); return [...Array(n).keys()].map(i => lists.reduce((t, l) => yoyAdd(t, l[i]), yoyZero())); };
  const now = merge('now'), last = merge('last'), lw = merge('lastWeek'), n = now.length;
  const sameTime = rows => { if (!live) return rows.reduce(yoyAdd, yoyZero()); let t = yoyZero(); rows.forEach((r, i) => { if (i < n - 1) t = yoyAdd(t, r); else if (i === n - 1) t = yoyAdd(t, yoyScale(r, frac)); }); return t; };
  const sh = now.reduce(yoyAdd, yoyZero()), shLy = sameTime(last), shLw = sameTime(lw);
  const upTo = live ? ' by ' + yoyTime(V.asOf) : '';
  if (shops.length) {
    set('yoyShToday', yoyMoney(sh.sales), yoyInt(sh.orders) + ' orders · ' + yoyInt(sh.units) + ' units');
    const [a, ac] = chg(sh.sales, shLy.sales); set('yoyShVsLy', a, yoyDate(V.ly) + upTo + ': ' + yoyMoney(shLy.sales) + ' · ' + yoyInt(shLy.orders) + ' orders', ac);
    const [b, bc] = chg(sh.sales, shLw.sales); set('yoyShVsLw', b, yoyDate(V.lw, false) + upTo + ': ' + yoyMoney(shLw.sales) + ' · ' + yoyInt(shLw.orders) + ' orders', bc);
    set('yoyShAov', sh.orders ? '$' + (sh.sales / sh.orders).toFixed(2) : '—', (sh.orders ? (sh.units / sh.orders).toFixed(2) + ' units an order' : '') + (shLy.orders ? ' · last year $' + (shLy.sales / shLy.orders).toFixed(2) : ''));
  } else ['yoyShToday', 'yoyShVsLy', 'yoyShVsLw', 'yoyShAov'].forEach(id => set(id, '—', errs[0] ? 'could not read Shopify' : 'waiting for the backend update'));
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
  } else {
    const why = metaErr ? 'Meta: ' + metaErr : metas.length && metas.every(m => m.configured === false) ? 'add META_TOKEN + META_AD_ACCOUNT in Script Properties' : 'waiting for Meta';
    set('yoyMetaSpend', '—', why); set('yoyMetaRoas', '—', '');
  }
  $('yoyShopNote').textContent = '· Shopify Admin API, Pacific day' + (M ? ' · Meta Marketing API (ad account’s own day)' : '') + (errs.length ? ' · ' + errs.join(' · ') : '');
  // --- all channels ---
  const allSales = amzToday.sales + sh.sales, allLy = amzLySame.sales + shLy.sales;
  set('yoyAllSales', yoyMoney(allSales), 'Amazon ' + yoyMoney(amzToday.sales) + ' · Shopify ' + yoyMoney(sh.sales));
  const [c, cc] = chg(allSales, allLy); set('yoyAllVsLy', c, yoyDate(V.ly) + upTo + ': ' + yoyMoney(allLy), cc);
  const spend = (amzAds ? amzAds.spend : 0) + (M ? M.spend : 0);
  const parts = [amzAds ? 'Amazon ' + yoyMoney(amzAds.spend) : 'Amazon pending', M ? 'Meta ' + yoyMoney(M.spend) : 'Meta not connected'];
  set('yoyAllSpend', amzAds || M ? yoyMoney(spend) : '—', parts.join(' · '));
  set('yoyAllTacos', amzAds || M ? pc(spend, allSales) : '—', amzAds && M ? 'all ads ÷ all sales' : 'so far without ' + (amzAds ? 'Meta' : 'Amazon ads'));
  set('yoyAllAmz', pc(amzToday.sales, allSales), yoyInt(amzToday.orders) + ' orders');
  set('yoyAllShop', pc(sh.sales, allSales), yoyInt(sh.orders) + ' orders');
}

/* ---------- SVG helpers ---------- */
const YOY_NS = 'http://www.w3.org/2000/svg';
function yoyEl(tag, attrs, parent, text) {
  const e = document.createElementNS(YOY_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
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
    const r = yoyEl('rect', { x: x + 1, y: y(v), width: Math.max(1, bw - 2), height: Math.max(0, y(0) - y(v)), rx: 2, fill: g.fill,
      opacity: i === g.part ? 0.55 : 1 }, svg);
    const when = g.dates && g.dates[i] ? yoyDate(g.dates[i]) : (tipLabel ? tipLabel(i) : labels[i]);
    yoyEl('title', {}, r, `${g.name} · ${when}: ${yoyMoney(v)}${i === g.part ? ' (so far)' : ''}`);
  }));
  if (line) {
    const pts = line.vals.map((v, i) => `${xc(i)},${y(v || 0)}`).join(' ');
    yoyEl('polyline', { points: pts, fill: 'none', stroke: 'var(--yoy-lw)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }, svg);
    line.vals.forEach((v, i) => {
      const c = yoyEl('circle', { cx: xc(i), cy: y(v || 0), r: 6, fill: 'transparent' }, svg);
      yoyEl('title', {}, c, `${line.name} · ${tipLabel ? tipLabel(i) : labels[i]}: ${yoyMoney(v)}`);
    });
  }
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
      'stroke-linejoin': 'round', 'stroke-dasharray': l.dash ? '5 4' : '' }, svg);
    l.vals.forEach((v, i) => {
      if (v == null) return;
      const c = yoyEl('circle', { cx: xc(i), cy: y(v), r: 6, fill: 'transparent' }, svg);
      yoyEl('title', {}, c, `${l.name} · by end of ${labels[i]} hour: ${yoyMoney(v)}`);
    });
    const last = pts[pts.length - 1];
    yoyEl('circle', { cx: last[0], cy: last[1], r: 3.5, fill: l.stroke }, svg);
    ends.push({ x: last[0] + 8, y: last[1] + 4, text: l.end, fill: l.stroke });
  });
  // Keep the end labels from sitting on top of each other.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14 && Math.abs(ends[i].x - ends[i - 1].x) < 120) ends[i].y = ends[i - 1].y + 14;
  ends.forEach(e => yoyEl('text', { x: e.x, y: e.y, class: 'yoy-lbl', style: 'fill:' + e.fill }, svg, e.text));
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
$('yoyDay').onchange = () => yoyLoad();
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
try {
  const saved = localStorage.getItem('yoy.brand');
  if (saved && $('yoyBrand').querySelector(`[data-ch="${saved}"]`)) {
    YOY_BRAND = saved;
    $('yoyBrand').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.ch === saved));
  }
} catch (e) { /* no storage */ }
