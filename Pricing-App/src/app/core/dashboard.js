/* ================= CORE · DASHBOARD: the first screen after sign-in — the business in five seconds (24 Nov 2026 redesign) =================
 * Screens: Dashboard (tab 'dash', #paneDash; core/nav.js calls ensureDash when it opens), the Sellora logo in the top bar (opens
 *          it) and the ✨ button beside the theme switch (#fxBtn: the animation on / off for the Dashboard and the Sales Dashboard —
 *          sales/sales-charts.js reads the same choice, selloraDashFx).
 * Does: for Ridhi / CPC / All (remembered in this browser), top to bottom, nothing else:
 *   1. the greeting, the date, the brand switch and "Updated HH:MM";
 *   2. ONE LINE written from the real numbers ("November is going well: $560k so far, +70% vs last year, on track for ~$827k.") —
 *      dashSummaryText; down: "… −Y% vs last year — 2 products to watch" (Sales Alerts' confirmed ones);
 *   3. four KPI cards: Sales this month · Yesterday · Ad spend this week + TACoS · Year to date vs last year — each with its ▲ / ▼, a
 *      small trend line and its exact definition (ⓘ, keyboard-reachable);
 *   4. one chart: daily sales vs last year, the last 30 days (last year = the same weekday, 364 days back, as the Sales Dashboard);
 *   5. small cards: "This week, explained" (sales/sales-insight.js), "New listings" (listing/new-listings.js) and, only when there is
 *      one, "Wins this week" (Sales Alerts' confirmed wins).
 *   NO LISTING ERROR COUNTS here (24 Nov 2026, the MD: some errors are left on purpose) — they live on Listing Health, Image Manager,
 *   Listing Errors… with every detail; "New listings → Open" takes you to Listing Health's "New (30 days)" with its errors.
 *   EVERY NUMBER IS ANOTHER SCREEN'S, with its "as of":
 *     sales   the Sales Dashboard's own loader (ensureSales) and sums (sdSum, sdSeries, sdLastYear) — MTD and YTD include today like
 *             its cards, their % on complete days like its cards; the month projection is its "where this month lands" rule;
 *     ads     the PPC & Organic weekly store (WEEKLY, else ONE read of its saved snapshot into the Dashboard's OWN copy) — the latest
 *             week as renderWeeklyKpis adds it, TACoS against the week before;
 *     vi / al This week in plain English / Sales Alerts, their own Dashboard hooks (viDashOf, alDashOf);
 *     nl      New listings (nlNow / nlSummary): Listing Health's rows, the listing cache, the sales stores, Listing History.
 *   NEVER EMPTY: each card first shows what it showed last time (this browser's copy, selloraDash.v4, amber "as of <time>"), then
 *   the fresh number; the very first time, a skeleton in the card's exact shape (no jump when the number lands).
 *   (DASH_CALC.age stays for Numbers Check, sales/sales-check.js, which compares it with Inventory Age; it is not drawn here.)
 * NEVER: an Amazon refresh, AI, or a write anywhere but this browser (localStorage).
 * Look: calm cards (16px, soft border, a shadow only in light), one blue for this year, green / red only on ▲ / ▼. Motion (GSAP 3.12.5
 *       from jsDelivr, else CSS; ✨ off or reduced motion: none): the line fades in, the numbers count up, the trend lines and the chart
 *       draw once. Every count ends on the exact text, whatever happens to the animation.
 * Main functions: ensureDash, dashPrefetch, dashRun, dashWatch, dashData, dashSummaryText, dashRender, dashPaint, dashAnim. */

// var, not const: core/nav.js's load-time showTab calls ensureDash before this file has run (it waits for this).
var DASH_READY = false;
const DASH_LS = { brand: 'selloraDashBrand', fx: 'selloraDashFx', cache: 'selloraDash.v4', nl: 'selloraDashNlDays' };
const DASH_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/';
const DASH_TIMEOUT = 15000;
const DASH = { brand: 'ALL', nlDays: 30, st: {}, memo: {}, sigUsed: {}, shown: {}, was: {}, tw: {}, timing: {}, t0: 0, weekly: null,
  gs: null, eng: 'none', cu: [], raf: 0, safety: 0, rendered: false, lastFresh: 0, watchT: 0, drawn: {} };
const DASH_NUM = new Intl.NumberFormat('en-US');
const DASH_FMT = {
  money: v => '$' + DASH_NUM.format(Math.round(v)),         // the Sales Dashboard's sdMoney: whole dollars
  num: v => DASH_NUM.format(Math.round(v)),
  pct: v => (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(1) + '%',
};
// The page, top to bottom.
const DASH_SLOTS = ['summary', 'kMtd', 'kYest', 'kAds', 'kYtd', 'chart', 'cVi', 'cNew', 'cWins'];
// Each data source: the screen whose access it needs, and the cards it fills.
const DASH_KEYS = {
  sales: { tab: 'sales', slots: ['summary', 'kMtd', 'kYest', 'kYtd', 'chart'] },
  ads: { tab: 'ppcn', slots: ['kAds'] },
  vi: { tab: 'sales', slots: ['cVi'] },                 // This week in plain English (sales/sales-insight.js)
  al: { tab: 'salert', slots: ['summary', 'cWins'] },   // Sales Alerts (sales/sales-alerts.js): "N products to watch", the wins
  nl: { tab: 'health', slots: ['cNew'] },               // New listings (listing/new-listings.js)
};
const DASH_VIEWS = ['ALL', 'SP', 'CPC'];
const DASH_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DASH_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dashEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const dashGet = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const dashSet = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* private window: not remembered */ } };
const dashSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dashBrandsOf = view => (view === 'ALL' ? ['SP', 'CPC'] : [view]);
const dashName = b => (b === 'SP' ? 'Ridhi' : b);
// May this account open screen t? (TAB_OK is set by core/access.js applyPerms once the account's rights are known.)
const dashMay = t => typeof TAB_OK === 'function' && !!TAB_OK(t);
const dashMayKey = k => (k === 'ads' ? dashMay('ppcn') || dashMay('weekly') : dashMay(DASH_KEYS[k].tab));
const dashAdKey = () => (typeof adBrands === 'function' ? adBrands().join(',') : 'SP,CPC');
const dashWhen = d => {
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t) ? '' : t.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const dashHm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dashMq = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
const dashReduce = () => dashMq('(prefers-reduced-motion: reduce)');
const dashFxSaved = () => dashGet(DASH_LS.fx) !== '0';
const dashFxOn = () => dashFxSaved() && !dashReduce();
// How the Dashboard moves right now: 'gsap', 'css' (GSAP not loaded), or 'none' (✨ off / reduced motion).
const dashEngine = () => (!dashFxOn() ? 'none' : window.gsap && DASH.gs === true ? 'gsap' : 'css');
const dashShown = () => !!$('paneDash') && !$('paneDash').classList.contains('hide');
const dashMs = () => Math.round(performance.now() - (DASH.t0 || 0));
const dashDay = iso => { const d = new Date(iso + 'T00:00:00Z'); return DASH_DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + DASH_MONTH[d.getUTCMonth()].slice(0, 3); };
// "$560k", "$56.3k", "$8,450", "$1.24M" — the summary line's money (the cards keep every dollar).
function dashCompact(v) {
  const a = Math.abs(Number(v) || 0), s = v < 0 ? '−' : '';
  const trim = x => x.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (a >= 1e6) return s + '$' + trim((a / 1e6).toFixed(2)) + 'M';
  if (a >= 1e5) return s + '$' + Math.round(a / 1e3) + 'k';
  if (a >= 1e4) return s + '$' + trim((a / 1e3).toFixed(1)) + 'k';
  return s + '$' + DASH_NUM.format(Math.round(a));
}
// A change as the summary says it: whole per cent from 10 %, one decimal under it; "+" or "−".
const dashPctWord = p => (p >= 0 ? '+' : '−') + (Math.abs(p) >= 10 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)) + '%';

/* ================= THE NAME: the account's display name; else the e-mail name — never a two-letter piece of it ================= */
function dashWho() {
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const user = typeof auth !== 'undefined' && auth && auth.currentUser;
  const shown = user && String(user.displayName || '').trim();
  if (shown) { const first = shown.split(/\s+/)[0]; return first.length >= 3 ? first : shown; }
  const local = String((typeof ME !== 'undefined' && ME.email) || (user && user.email) || '').split('@')[0];
  const parts = local.split(/[._\-+\d]+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts[0].length >= 3) return cap(parts[0]);
  const whole = parts.map(cap).join(' ');
  return whole.replace(/\s/g, '').length >= 3 ? whole : '';
}

/* ================= THE BROWSER COPY: the last numbers each card showed, per brand view ================= */
function dashCacheAll() {
  try { return JSON.parse(dashGet(DASH_LS.cache) || '{}') || {}; } catch (e) { return {}; }
}
// The copies of the old page (v2 / v3 held Listing Health counts) and its confetti day go.
(() => { try { ['selloraDash.v3', 'selloraDash.v2', 'selloraDashConfetti'].forEach(k => localStorage.removeItem(k)); } catch (e) { /* nothing kept */ } })();
// Keep a source's fresh numbers for all three views (All, Ridhi, CPC), so the next sign-in shows them at once.
function dashStore(key) {
  const res = dashCalc(key);
  if (!res) return;
  const all = dashCacheAll();
  const into = all[key] || (all[key] = {});
  DASH_VIEWS.forEach(view => {
    if (res[view] && !res[view].empty) into[view] = Object.assign({}, res[view], { at: Date.now(), ab: key === 'ads' ? dashAdKey() : undefined });
  });
  dashSet(DASH_LS.cache, JSON.stringify(all));
}

/* ================= WORKING OUT THE NUMBERS — from what is in memory, all three views at once (kept until an input changes) ================= */
// What each source's numbers are worked out from — when any of these is a different object or value, they are worked out again.
const DASH_SIG = {
  sales: () => [SD && SD.at, SD && SD.d, SD_LIVE, typeof T_MATCH !== 'undefined' && T_MATCH.biz, sdToday()],
  ads: () => [WEEKLY.rows, WEEKLY.at, DASH.weekly],
  vi: () => [typeof VI !== 'undefined' ? VI.v : 0, typeof sdToday === 'function' ? sdToday() : '', H_LOADED],
  al: () => [typeof AL !== 'undefined' ? AL.v : 0, typeof VI !== 'undefined' ? VI.v : 0, typeof sdToday === 'function' ? sdToday() : '', H_LOADED,
    typeof AL !== 'undefined' ? AL.store.marks : null, typeof AL !== 'undefined' ? AL.store.settings : null],
  nl: () => [typeof nlNow === 'function' ? nlNow() : null],
};
const dashSigOf = key => { try { return DASH_SIG[key](); } catch (e) { return [Math.random()]; } };
const dashSame = (a, b) => !!(a && b && a.length === b.length && a.every((x, i) => x === b[i]));
function dashCalc(key) {
  if (key in DASH.memo) return DASH.memo[key];
  let res = null;
  DASH.sigUsed[key] = dashSigOf(key);
  try { res = DASH_CALC[key](); } catch (e) { res = null; }
  DASH.memo[key] = res;
  return res;
}
const dashPerView = fn => { const out = {}; DASH_VIEWS.forEach(view => { out[view] = fn(view); }); return out; };
const DASH_CALC = {
  // This week in plain English (sales/sales-insight.js): the first sentence of the summary, per view — the same movers as the box
  vi: () => dashPerView(view => viDashOf(view)),
  // Sales Alerts (sales/sales-alerts.js): how many to watch, and the confirmed wins, per view — the page's own lists
  al: () => dashPerView(view => alDashOf(view)),
  // New listings (listing/new-listings.js), per view and per window (7 / 30 days)
  nl: () => {
    const res = typeof nlNow === 'function' ? nlNow() : null;
    if (!res) return null;
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => HEALTH[b] && HEALTH[b].rows);
      if (!bs.length) return { empty: true, why: 'no Listing Health snapshot yet' };
      const w = {};
      NL_WINDOWS.forEach(n => { w[n] = nlSummary(res, bs, n); });
      const lm = typeof lmDataLabel === 'function' ? lmDataLabel(bs) : null;
      const at = bs.map(b => HEALTH[b].at).filter(Boolean).map(d => d.getTime());
      return { w, src: res.src, salesAt: res.salesAt, only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: (lm ? 'listings: ' + lm.text : at.length ? 'listings: snapshot ' + dashWhen(Math.min(...at)) : 'listings: Listing Health')
          + (res.salesAt ? ' · sales up to ' + res.salesAt : '') };
    });
  },
  // The Sales Dashboard's own sums: sdSum / sdSeries read the channel on view (SD_CH), so it is set for each brand and put back
  // straight after, in the same moment (nothing else runs in between). Numbers Check compares mtd / ytd with the Sales Dashboard.
  sales: () => {
    if (!(SD && SD.at)) return null;
    const keep = SD_CH;
    const today = sdToday(), yest = sdShift(today, -1);
    const monthStart = today.slice(0, 8) + '01', yearStart = today.slice(0, 4) + '-01-01';
    const T = typeof T_MATCH !== 'undefined' && T_MATCH.biz;
    const when = 'nightly run ' + SD.at + (SD_LIVE ? ' · today ' + SD_LIVE : '') + (T ? ' · Seller Central totals' : '');
    // the Sales Dashboard's "where this month lands": complete days so far + the last 7 complete days' rate × the days still to come
    const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    const doneDays = Number(today.slice(8, 10)) - 1;
    const days30 = [];
    for (let i = 29; i >= 0; i--) days30.push(sdShift(today, -i));
    try {
      return dashPerView(view => {
        const bs = dashBrandsOf(view);
        const sum = (from, to) => Math.round(bs.reduce((t, ch) => { SD_CH = ch; return t + sdSum(from, to)[0]; }, 0) * 100) / 100;
        // day → sales, the brands added together; a day no brand holds is not there (missing is not $0)
        const byDay = (from, to) => {
          const by = {};
          bs.forEach(ch => { SD_CH = ch; sdSeries(from, to).forEach(p => { by[p.d] = (by[p.d] || 0) + p.v; }); });
          return by;
        };
        const mc = sum(monthStart, yest), ml = sum(sdLastYear(monthStart), sdLastYear(yest));
        const yc = sum(yearStart, yest), yl = sum(sdLastYear(yearStart), sdLastYear(yest));
        const rate7 = sum(sdShift(yest, -6), yest) / 7;
        const ty = byDay(sdShift(today, -29), today), ly = byDay(sdShift(today, -29 - 364), sdShift(today, -364));
        const r2 = v => (v == null ? null : Math.round(v * 100) / 100);
        const days = days30.map(d => ({ d, v: d in ty ? r2(ty[d]) : null, ly: sdShift(d, -364) in ly ? r2(ly[sdShift(d, -364)]) : null }));
        // the trend lines: this month's complete days (else the last 30), the last 30 complete days, the YTD % vs last year day by day
        const done = days.slice(0, -1);
        const monthDays = done.filter(p => p.d >= monthStart);
        const ytdTy = byDay(yearStart, yest), ytdLy = byDay(sdLastYear(yearStart), sdLastYear(yest));
        const ytdPct = [], from30 = sdShift(yest, -29);
        let a = 0, b = 0;
        for (let d = yearStart; d <= yest; d = sdShift(d, 1)) {
          a += ytdTy[d] || 0;
          b += ytdLy[sdLastYear(d)] || 0;
          if (d >= from30) ytdPct.push(b ? (a - b) / b * 100 : null);
        }
        const yLyDay = sdShift(yest, -364);
        return { mtd: sum(monthStart, today), ytd: sum(yearStart, today), mc, ml, yc, yl,
          yest: sum(yest, yest), yestDay: yest, yestLy: yLyDay in ly ? r2(ly[yLyDay]) : sum(yLyDay, yLyDay), yestLyDay: yLyDay,
          rate7: Math.round(rate7 * 100) / 100, proj: Math.round(((doneDays > 0 ? mc : 0) + rate7 * (daysInMonth - doneDays)) * 100) / 100,
          doneDays, daysInMonth, month: DASH_MONTH[Number(today.slice(5, 7)) - 1], today,
          spark: { mtd: (monthDays.length >= 2 ? monthDays : done).map(p => p.v), yest: done.map(p => p.v), ytd: ytdPct },
          days, day: SD.at, when };
      });
    } finally { SD_CH = keep; }
  },
  // PPC & Organic: per week of the last 8, sales and ad spend; the latest week's TACoS as renderWeeklyKpis works it out, and the week before.
  ads: () => {
    const W = WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length ? WEEKLY : DASH.weekly;
    if (!W) return null;
    const ad = typeof adBrands === 'function' ? adBrands() : ['SP', 'CPC'];
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => ad.includes(b));
      if (!bs.length || !Object.keys(W.rows).length) return { empty: true, when: bs.length ? 'nothing stored yet' : 'not in your access' };
      const all = bs.length === 2;                     // wRows: "All" keeps every row; one brand keeps its rows
      const rows = Object.values(W.rows).filter(r => all || bs.includes(r.brand || ''));
      const weeks = (W.weeks.length ? W.weeks : wWeeksList(26)).slice(-8);
      const per = weeks.map(w => {
        let rev = 0, spend = 0;
        rows.forEach(r => { const c = (r.weeks || {})[w]; if (c) { rev += c.rev || 0; spend += c.spend || 0; } });
        return { w, rev, spend, done: wWeekDone(w), label: wLabel(w) };
      });
      const last = per[per.length - 1], prev = per[per.length - 2];
      return { per, last, tacos: last && last.rev ? Math.round(last.spend / last.rev * 100) : null, days: last && !last.done ? wDaysIn(last.w) : 7,
        prevTacos: prev && prev.rev ? Math.round(prev.spend / prev.rev * 100) : null, prevLabel: prev ? prev.label : '',
        only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: (W.at ? 'sales as at ' + W.at : 'not pulled yet') + (W.adAt ? ' · ads ' + W.adAt : '') };
    });
  },
  // Inventory Age: aged 181+ units and the storage charge, as renderAgeKpis adds them up — NOT on this page; Numbers Check reads it.
  age: () => {
    if (!AGE_LOADED) return null;
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => AGE[b]);
      if (!bs.length) return { empty: true, when: 'no snapshot yet' };
      const cols = totalCols([...new Set(bs.flatMap(b => AGE[b].cols))]);
      const aged = cols.filter(c => { const r = ageRange(c); return r && r[0] >= AGED_FROM; });
      let units = 0, storage = 0;
      bs.forEach(b => AGE[b].rows.forEach(r => {
        units += aged.reduce((s, c) => s + ((r.age || {})[c] || 0), 0);
        storage += r.storage || 0;
      }));
      const ats = bs.map(b => AGE[b].at).filter(Boolean);
      return { units, storage, only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: ats.length ? 'updated ' + dashWhen(new Date(Math.min(...ats.map(d => d.getTime())))) : '' };
    });
  },
};

/* ================= THE ONE LINE: written by code from the real numbers, never a number of its own ================= */
// s = the sales numbers of one view, al = Sales Alerts' (or null). → { tone: 'up' | 'level' | 'down' | 'neutral', text }.
function dashSummaryText(s, al) {
  if (!s) return null;
  const so = dashCompact(s.mtd);
  const track = s.rate7 > 0 ? `on track for ~${dashCompact(s.proj)}` : '';
  if (!s.doneDays) return { tone: 'neutral', text: `${s.month} has just begun: ${so} so far today${track ? ', ' + track : ''}.` };
  if (!s.ml) return { tone: 'neutral', text: `${s.month} so far: ${so}${track ? ', ' + track : ''}. No last-year figures to compare with yet.` };
  const pct = (s.mc - s.ml) / s.ml * 100;
  if (pct >= 2) return { tone: 'up', text: `${s.month} is going well: ${so} so far, ${dashPctWord(pct)} vs last year${track ? ', ' + track : ''}.` };
  if (pct > -2) return { tone: 'level', text: `${s.month} is level with last year: ${so} so far (${dashPctWord(pct)})${track ? ', ' + track : ''}.` };
  const watch = al && !al.empty && al.n ? ` — ${al.n} product${al.n === 1 ? '' : 's'} to watch` : '';
  return { tone: 'down', text: `${s.month}: ${so} so far, ${dashPctWord(pct)} vs last year${track ? ', ' + track : ''}${watch}.` };
}

/* ================= LOADING — read-only, each source on its own ================= */
// The backend address arrives a moment after sign-in (core/auth.js reads config/api): wait for it, at most 15 s.
async function dashApi() {
  for (let i = 0; i < 300 && !(typeof API !== 'undefined' && API && API.url); i++) await dashSleep(50);
}
// Sales: the Sales Dashboard's own loader — the latest nightly history, the live top-up, then Seller Central's own totals.
async function dashLoadSales() {
  await dashApi();
  await ensureSales();
  dashChanged('sales');
  if (SD_BUSY) await SD_BUSY;
}
// PPC & Organic: what that screen holds, else ONE read of its saved snapshot (audit/weekly + weeklyrows/n) into the Dashboard's own copy.
// (Also used by This week, Sales Alerts, Numbers Check and New listings.)
async function dashLoadAds() {
  if (WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length) return;
  if (DASH.weekly) return;
  const meta = await getDoc(doc(db, 'audit', 'weekly'));
  if (!meta.exists()) { DASH.weekly = { weeks: [], rows: {}, at: '', adAt: '' }; return; }
  const d = meta.data();
  const rows = {};
  if (d.chunks) {
    const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'weeklyrows', String(i)))));
    got.forEach(s => { if (s.exists()) Object.assign(rows, s.data().r || {}); });
  }
  DASH.weekly = { weeks: d.weeks || [], rows, at: d.at || '', adAt: d.adAt || '' };
}
const DASH_LOAD = { sales: dashLoadSales, ads: dashLoadAds, vi: () => viDashLoad(), al: () => alDashLoad(), nl: async () => { await dashApi(); await nlLoad(); } };

// A source's data changed: work its numbers out again, and redraw its cards when the Dashboard is on screen.
function dashChanged(key) {
  delete DASH.memo[key];
  if (dashShown() && DASH.rendered) dashPaint([...new Set(DASH_KEYS[key].slots)], 'swap');
}
// Load one source: its own 15-second clock, its cards redrawn when it lands (or fails), its numbers kept in this browser.
function dashRun(key) {
  if (!dashMayKey(key)) return;
  const st = DASH.st[key];
  if (st && (st.s === 'loading' || st.s === 'ok')) return;
  DASH.st[key] = { s: 'loading', t0: dashMs() };
  dashChanged(key);
  const timer = setTimeout(() => { if (DASH.st[key].s === 'loading') { DASH.st[key].s = 'timeout'; dashChanged(key); } }, DASH_TIMEOUT);
  Promise.resolve().then(DASH_LOAD[key]).then(() => { DASH.st[key] = { s: 'ok', ms: dashMs() }; DASH.lastFresh = Date.now(); },
    e => { DASH.st[key] = { s: 'fail', why: String((e && e.message) || e || '') }; })
    .then(() => { clearTimeout(timer); delete DASH.memo[key]; if (DASH.st[key].s === 'ok') dashStore(key); dashChanged(key); dashUpdated();
      if (typeof ncSoon === 'function') ncSoon(key); });   // Numbers Check runs again on what just loaded (sales/sales-check.js)
}
// Every source, sales first.
function dashPrefetch() {
  if (!dashMay('dash')) return;
  ['sales', 'ads', 'vi', 'al', 'nl'].forEach(dashRun);
  if (!DASH.watchT) DASH.watchT = setInterval(dashWatch, 2000);
}
// Every 2 s: a loaded source whose inputs changed since its numbers were worked out (a screen loaded more, the listing cache
// refreshed, a live read landed) is worked out again — and kept. Only the cheap identity checks run when nothing changed.
function dashWatch() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  Object.keys(DASH_KEYS).forEach(key => {
    if (!DASH.st[key] || DASH.st[key].s !== 'ok' || !DASH.sigUsed[key]) return;
    if (dashSame(dashSigOf(key), DASH.sigUsed[key])) return;
    delete DASH.memo[key];
    dashCalc(key);
    dashStore(key);
    DASH.lastFresh = Date.now();
    if (dashShown() && DASH.rendered) { dashPaint([...new Set(DASH_KEYS[key].slots)], 'swap'); dashUpdated(); }
  });
}

/* ================= WHAT A CARD SHOWS: fresh, else cached (amber), else a skeleton while loading, else why not ================= */
function dashData(key) {
  if (!dashMayKey(key)) return { state: 'deny' };
  const st = DASH.st[key] || { s: 'idle' };
  if (st.s === 'ok') {
    const res = dashCalc(key);
    if (res && res[DASH.brand]) { dashMark(key, 'fresh'); return { state: 'fresh', v: res[DASH.brand] }; }
  }
  const c = (dashCacheAll()[key] || {})[DASH.brand];
  if (c && (key !== 'ads' || c.ab === dashAdKey())) {
    dashMark(key, 'cached');
    const busy = st.s === 'loading' || st.s === 'idle';
    return { state: 'cached', v: c, note: busy ? ' · updating…' : st.why ? ' · ' + st.why : " · couldn't update" };
  }
  if (st.s === 'loading' || st.s === 'idle') return { state: 'loading' };
  return { state: 'fail', why: st.why };
}
// For the timing report: when each card first showed its cached and its fresh number (ms after sign-in).
function dashMark(key, kind) {
  const t = DASH.timing[key] || (DASH.timing[key] = {});
  if (t[kind] == null && dashShown()) t[kind] = dashMs();
}
const dashOk = d => (d.state === 'fresh' || d.state === 'cached') && d.v && !d.v.empty;
const dashSk = (w, h) => `<span class="dash-sk" style="width:${w}${h ? ';height:' + h : ''}" aria-hidden="true"></span>`;
const dashOpenBtn = (tab, label, level) => (dashMay(tab) ? `<button type="button" class="dash-open" data-dash-open="${tab}"${level ? ` data-dash-level="${level}"` : ''}${label ? ` aria-label="${dashEsc(label)}"` : ''}>Open <span aria-hidden="true">→</span></button>` : '');
// The "as of" under each card: the source's own time when fresh; amber "as of <when this browser saw it>" for a kept copy.
function dashAsOf(d) {
  if (d.state === 'fresh') return `<div class="dash-asof" title="${dashEsc(d.v.when)}">as of ${dashEsc(d.v.when)}</div>`;
  if (d.state === 'cached') { const t = 'as of ' + dashWhen(d.v.at) + d.note; return `<div class="dash-asof is-old" title="${dashEsc(t)}">${dashEsc(t)}</div>`; }
  if (d.state === 'loading') return '<div class="dash-asof">loading…</div>';
  if (d.state === 'deny') return '<div class="dash-asof">not in your access</div>';
  return `<div class="dash-asof" title="${dashEsc(d.why || '')}">couldn't load just now</div>`;
}
// A number that counts: the exact text is there from the start; the animation only runs towards it. k names it across redraws.
const dashCu = (v, fmt, k) => `<span data-cu="${Number(v) || 0}" data-fmt="${fmt}" data-k="${k}">${dashEsc(DASH_FMT[fmt](v))}</span>`;
// ▲ / ▼ with its per cent; `good` says which way is green (TACoS: down is good). No baseline: "—", never a made-up 0 %.
function dashChg(now, was, what, good) {
  if (!was || now == null) return `<span class="dash-chg is-none">—</span><span class="dash-vs">${dashEsc(what ? 'no ' + what + ' to compare' : '')}</span>`;
  const p = (now - was) / was * 100;
  const fine = good === 'down' ? p <= 0 : p >= 0;
  return `<span class="dash-chg ${fine ? 'is-up' : 'is-dn'}"><span aria-hidden="true">${p < 0 ? '▼' : '▲'}</span> ${Math.abs(p).toFixed(1)}%</span><span class="dash-vs">vs ${dashEsc(what)}</span>`;
}
// A small trend line (a path the motion draws once). A gap in the values breaks it.
function dashSpark(vals, label) {
  const v = (vals || []).map(x => (x == null || !isFinite(x) ? null : Number(x)));
  const have = v.filter(x => x != null);
  if (have.length < 2) return '<div class="dash-spark is-none" aria-hidden="true"></div>';
  const W = 120, H = 36, max = Math.max(...have), min = Math.min(...have), span = max - min || 1;
  let d = '', pen = false;
  v.forEach((x, i) => {
    if (x == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${(i / (v.length - 1) * W).toFixed(1)} ${(H - 3 - (x - min) / span * (H - 6)).toFixed(1)}`;
    pen = true;
  });
  return `<svg class="dash-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${dashEsc(label)}"><path d="${d}"/></svg>`;
}
// One KPI card: label + ⓘ (its definition, on hover and on keyboard focus), the big number, ▲ / ▼, the trend line, "as of".
function dashKpi(id, label, def, d, body) {
  const ok = dashOk(d);
  const tip = `dashTip-${id}`;
  const b = ok ? body(d.v) : null;
  return `<article class="dash-card dash-kpi" aria-label="${dashEsc(label)}">`
    + `<div class="dash-kpi-h"><span class="dash-lbl">${dashEsc(label)}</span><span class="dash-info"><button type="button" class="dash-i" aria-label="What “${dashEsc(label)}” means" aria-describedby="${tip}">i</button>`
    + `<span class="dash-tipbox" role="tooltip" id="${tip}">${dashEsc(def)}</span></span></div>`
    + `<div class="dash-num">${ok ? b.num : d.state === 'loading' ? dashSk('62%', '34px') : '—'}</div>`
    + `<div class="dash-delta">${ok ? b.chg : d.state === 'loading' ? dashSk('48%', '16px') : ''}</div>`
    + (ok ? b.spark : d.state === 'loading' ? dashSk('100%', '36px') : '<div class="dash-spark is-none" aria-hidden="true"></div>')
    + dashAsOf(d) + '</article>';
}

// Each card's HTML.
const DASH_PAINT = {
  summary: () => {
    const d = dashData('sales'), a = dashData('al');
    if (d.state === 'deny') return '';
    if (!dashOk(d)) return `<div class="dash-sum-box">${d.state === 'loading' ? `<p class="dash-sum">${dashSk('72%', '26px')}</p>${dashSk('30%', '13px')}`
      : '<p class="dash-sum is-none">Sales numbers could not load just now — they will show here as soon as they do.</p>'}</div>`;
    const s = dashSummaryText(d.v, dashOk(a) ? a.v : null);
    return `<div class="dash-sum-box"><p class="dash-sum is-${s.tone}" aria-live="polite">${dashEsc(s.text)}</p>`
      + `<div class="dash-sum-asof${d.state === 'cached' ? ' is-old' : ''}">Sales Dashboard figures · ${dashEsc(d.state === 'cached' ? 'as of ' + dashWhen(d.v.at) + d.note : d.v.when)}${
        s.text.includes('on track') ? ' · “on track” = the Sales Dashboard\'s month projection (complete days + the last 7 days\' rate)' : ''}</div></div>`;
  },
  kMtd: () => dashKpi('mtd', 'Sales this month', 'Month to date: every order from the 1st to now (US Pacific days), as the Sales Dashboard shows it. ▲ / ▼ compares complete days only — the 1st to yesterday — with the same dates last year. The line: daily sales this month.',
    dashData('sales'), v => ({ num: dashCu(v.mtd, 'money', 'mtd'), chg: dashChg(v.mc, v.ml, 'last year', 'up'), spark: dashSpark(v.spark.mtd, 'Daily sales this month') })),
  kYest: () => dashKpi('yest', 'Yesterday', 'Yesterday\'s sales — one whole US Pacific day, as the Sales Dashboard\'s Yesterday card. ▲ / ▼ against the same weekday last year (364 days back), as its daily chart. The line: the last 30 complete days.',
    dashData('sales'), v => ({ num: dashCu(v.yest, 'money', 'yest'), chg: dashChg(v.yest, v.yestLy, dashDay(v.yestLyDay) + ' last year', 'up'), spark: dashSpark(v.spark.yest, 'Daily sales, the last 30 complete days') })),
  kAds: () => {
    const d = dashData('ads');
    return dashKpi('ads', 'Ad spend this week', 'Ad spend in the latest week (Sun–Sat) of PPC & Organic, as its latest-week card adds it; a running week counts its days so far (ads land 1–2 days late). TACoS = ad spend ÷ all sales that week; ▲ / ▼ against the week before — lower is better (green). The line: TACoS week by week, the last 8 weeks (a ratio, so a week still running does not dip).',
      d, v => ({ num: dashCu(v.last.spend, 'money', 'spend'),
        chg: `<span class="dash-tacos">TACoS <b>${v.tacos == null ? '—' : v.tacos + '%'}</b></span>${v.tacos != null && v.prevTacos != null
          ? (v.tacos === v.prevTacos ? `<span class="dash-vs">same as ${dashEsc(v.prevLabel)}</span>`
            : `<span class="dash-chg ${v.tacos < v.prevTacos ? 'is-up' : 'is-dn'}"><span aria-hidden="true">${v.tacos < v.prevTacos ? '▼' : '▲'}</span> ${Math.abs(v.tacos - v.prevTacos)} pt</span><span class="dash-vs">vs ${dashEsc(v.prevLabel)}</span>`) : ''}`
          + `<span class="dash-vs dash-wk">${dashEsc(v.last.label)}${v.last.done ? '' : ' · ' + v.days + '/7 days'}${v.only ? ' · ' + dashEsc(v.only) : ''}</span>`,
        spark: dashSpark(v.per.map(p => (p.rev ? p.spend / p.rev * 100 : null)), 'TACoS week by week, the last 8 weeks') }));
  },
  kYtd: () => {
    const d = dashData('sales');
    return dashKpi('ytd', 'Year to date vs last year', 'Sales from 1 January to yesterday against the same dates last year (complete days, as the Sales Dashboard\'s YTD %). Under it: year-to-date sales including today, as its YTD card. The line: that % day by day, the last 30 days.',
      d, v => (v.yl ? { num: `<span class="${v.yc >= v.yl ? 'is-up' : 'is-dn'}">${dashCu((v.yc - v.yl) / v.yl * 100, 'pct', 'ytdp')}</span>`,
        chg: `<span class="dash-vs">${DASH_FMT.money(v.ytd)} so far this year</span>`, spark: dashSpark(v.spark.ytd, 'Year to date vs last year, %, the last 30 days') }
        : { num: dashCu(v.ytd, 'money', 'ytd'), chg: '<span class="dash-chg is-none">—</span><span class="dash-vs">no last year to compare</span>', spark: dashSpark(v.spark.ytd, '') }));
  },
  chart: () => {
    const d = dashData('sales');
    if (d.state === 'deny') return '';
    const ok = dashOk(d) && d.v.days && d.v.days.some(p => p.v != null);
    return `<article class="dash-card dash-chartcard"><div class="dash-chart-h"><h3 class="dash-h3">Daily sales vs last year</h3>`
      + `<span class="dash-chart-sub">Last 30 days · <i class="dash-k is-ty" aria-hidden="true"></i>this year <i class="dash-k is-ly" aria-hidden="true"></i>last year, same weekday</span>${dashOpenBtn('sales', 'Open the Sales Dashboard')}</div>`
      + (ok ? dashChartHtml(d.v.days, d.v.today) : d.state === 'loading' ? `<div class="dash-plot">${dashSk('100%', '100%')}</div>`
        : '<div class="dash-plot is-none"><p>No daily sales to draw yet.</p></div>')
      + dashAsOf(d) + '</article>';
  },
  cVi: () => {
    const d = dashData('vi');
    if (d.state === 'deny') return '';
    const ok = dashOk(d);
    const head = ok && d.v.head ? `<b class="dash-vi-h">${dashEsc(d.v.head)}${d.v.pct != null ? ` <span class="dash-chg ${d.v.up ? 'is-up' : 'is-dn'}"><span aria-hidden="true">${d.v.up ? '▲' : '▼'}</span> ${Math.abs(d.v.pct).toFixed(1)}%</span>` : ''}</b>` : '';
    const body = ok ? head + `<span class="dash-vi-t">${dashEsc(d.v.text)}</span>` : d.state === 'fresh' && d.v && d.v.why ? `<span class="dash-muted">${dashEsc(d.v.why)}</span>`
      : d.state === 'loading' ? `${dashSk('70%', '18px')}${dashSk('95%', '14px')}${dashSk('80%', '14px')}` : '<span class="dash-muted">—</span>';
    return `<article class="dash-card dash-small"><div class="dash-small-h"><h3 class="dash-h3">This week, explained</h3>${dashOpenBtn('sales', 'Open the Sales Dashboard')}</div>`
      + `<p class="dash-vi">${body}</p>${dashAsOf(d)}</article>`;
  },
  cNew: () => {
    const d = dashData('nl');
    if (d.state === 'deny') return '';
    const n = DASH.nlDays;
    const tg = k => `<button type="button" data-dash-nl="${k}" aria-pressed="${n === k}">${k} days</button>`;
    const head = `<div class="dash-small-h"><h3 class="dash-h3">New listings</h3><span class="dash-seg dash-nl-seg" role="group" aria-label="Window">${tg(7)}${tg(30)}</span>`
      + `${dashOpenBtn('health', `Open Listing Health: new listings, last ${n} days`, 'new' + n)}</div>`;
    if (!dashOk(d)) {
      const body = d.state === 'loading' ? `<div class="dash-nl-n">${dashSk('55%', '34px')}</div>${dashSk('85%', '14px')}<div class="dash-nl-bars">${dashSk('100%', '40px')}</div>${dashSk('60%', '14px')}`
        : `<p class="dash-muted">${dashEsc(d.state === 'fresh' && d.v && d.v.why ? d.v.why : 'New listings could not be worked out just now.')}</p>`;
      return `<article class="dash-card dash-small dash-nl">${head}${body}${dashAsOf(d)}</article>`;
    }
    const w = d.v.w[n] || d.v.w[String(n)];
    if (!w) return `<article class="dash-card dash-small dash-nl">${head}<p class="dash-muted">—</p>${dashAsOf(d)}</article>`;
    const bars = dashBars(w.bars);
    const srcWords = { amazon: 'Amazon\'s create / open date', snapshot: 'first Sellora snapshot', lh: 'Listing History (Create Listing)' };
    const srcNote = `First-listed date: ${(w.srcUsed && w.srcUsed.length ? w.srcUsed : ['amazon']).map(k => srcWords[k] || k).join(' · ')}`
      + (w.relisted ? ` · ${w.relisted} relisted SKU${w.relisted === 1 ? '' : 's'} not counted` : '');
    if (!w.n) return `<article class="dash-card dash-small dash-nl">${head}<p class="dash-nl-empty">No new listings in the last ${n} days.</p>`
      + `${bars}<div class="dash-nl-src">${dashEsc(srcNote)}</div>${dashAsOf(d)}</article>`;
    const parts = [[w.selling, 'selling'], [w.nosale, 'live, no sale yet'], [w.notlive, 'not live yet']].map(([k, t]) => `${DASH_FMT.num(k)} ${t}`);
    if (w.nodata) parts.push(`${DASH_FMT.num(w.nodata)} no sales data yet`);
    return `<article class="dash-card dash-small dash-nl">${head}`
      + `<div class="dash-nl-n">${dashCu(w.n, 'num', 'nl' + n)}<span class="dash-nl-w"> new listing${w.n === 1 ? '' : 's'}</span></div>`
      + `<div class="dash-nl-split">${parts.join(' · ')}</div>${bars}`
      + (w.top ? `<div class="dash-nl-top" title="${dashEsc(w.top.name)}">Top: <b>${dashEsc(String(w.top.name).slice(0, 60))}</b> · ${DASH_FMT.num(w.top.units)} unit${w.top.units === 1 ? '' : 's'}</div>` : '')
      + `<div class="dash-nl-src">${dashEsc(srcNote)}${d.v.only ? ' · ' + dashEsc(d.v.only) : ''}</div>${dashAsOf(d)}</article>`;
  },
  cWins: () => {
    const d = dashData('al');
    if (!dashOk(d) || !d.v.wins || !d.v.wins.length) return '';
    return `<article class="dash-card dash-small dash-wins"><div class="dash-small-h"><h3 class="dash-h3">Wins this week</h3>${dashOpenBtn('salert', 'Open Sales Alerts')}</div>`
      + `<ul class="dash-win-l">${d.v.wins.slice(0, 2).map(x => `<li><span class="dash-win-n" title="${dashEsc(x.name)}">${dashEsc(x.name)}</span><b class="dash-win-v">+${Math.round(x.pct)}% · +${DASH_FMT.money(x.usd)}/wk</b></li>`).join('')}</ul>`
      + dashAsOf(d) + '</article>';
  },
};
// The new-listings bars: one per week, the last 8 (the running week last).
function dashBars(bars) {
  if (!bars || !bars.length) return '';
  const max = Math.max(1, ...bars.map(b => b.n));
  const total = bars.reduce((s, b) => s + b.n, 0);
  return `<div class="dash-nl-bars" role="img" aria-label="New listings per week, the last ${bars.length} weeks: ${bars.map(b => b.n).join(', ')} (${total} in all)">`
    + bars.map((b, i) => `<span class="dash-bar${i === bars.length - 1 ? ' is-now' : ''}" style="--h:${(b.n / max * 100).toFixed(1)}%" title="Week of ${dashEsc(dashDay(b.wk))}: ${b.n}"></span>`).join('') + '</div>';
}

/* ================= THE CHART: this year (blue, soft fill), last year (grey, dashed), today dashed — an SVG and a crosshair ================= */
const DASH_CW = 1000, DASH_CH = 300, DASH_CT = 14;
// A smooth line through the points (monotone cubic: it never overshoots a day), one piece per run of days that have a value.
function dashSmooth(pts) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]} ${pts[0][1]}` : '';
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}
const dashRuns = (vals, X, Y) => {
  const out = [];
  let cur = [];
  vals.forEach((v, i) => { if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
  if (cur.length) out.push(cur);
  return out;
};
const dashNice = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * p).find(k => k >= v); };
function dashChartHtml(days, today) {
  const n = days.length;
  const max = dashNice(Math.max(...days.map(p => Math.max(p.v || 0, p.ly || 0))) * 1.08);
  const X = i => i / (n - 1) * DASH_CW, Y = v => DASH_CT + (1 - v / max) * (DASH_CH - DASH_CT);
  const isToday = days[n - 1].d === today && days[n - 1].v != null;
  const tyMain = days.map((p, i) => (isToday && i === n - 1 ? null : p.v));
  const tyRuns = dashRuns(tyMain, X, Y), lyRuns = dashRuns(days.map(p => p.ly), X, Y);
  const line = tyRuns.map(dashSmooth).join(' ');
  const area = tyRuns.filter(r => r.length > 1).map(r => dashSmooth(r) + `L${r[r.length - 1][0].toFixed(1)} ${DASH_CH}L${r[0][0].toFixed(1)} ${DASH_CH}Z`).join(' ');
  const todayP = isToday && days[n - 2].v != null ? `M${X(n - 2).toFixed(1)} ${Y(days[n - 2].v).toFixed(1)}L${X(n - 1).toFixed(1)} ${Y(days[n - 1].v).toFixed(1)}` : '';
  const grid = [0, 0.5, 1].map(f => `<line class="dash-grid" x1="0" x2="${DASH_CW}" y1="${Y(max * f).toFixed(1)}" y2="${Y(max * f).toFixed(1)}"/>`).join('');
  const yl = [1, 0.5, 0].map(f => `<span class="dash-yl" style="top:${(Y(max * f) / DASH_CH * 100).toFixed(2)}%">${dashEsc(dashCompact(max * f))}</span>`).join('');
  const xl = [0, Math.round((n - 1) / 2), n - 1].map(i => `<span class="dash-xl" style="left:${(X(i) / DASH_CW * 100).toFixed(2)}%">${dashEsc(i === n - 1 && isToday ? 'Today' : dashDay(days[i].d))}</span>`).join('');
  // the summary a screen reader hears (and the chart's keyboard: ← → move the crosshair)
  const both = days.filter(p => p.v != null && p.ly != null && p.d !== today);
  const tySum = both.reduce((s, p) => s + p.v, 0), lySum = both.reduce((s, p) => s + p.ly, 0);
  const best = days.filter(p => p.d !== today && p.v != null).reduce((m, p) => (!m || p.v > m.v ? p : m), null);
  const aria = `Daily sales, the last ${n} days. On the ${both.length} complete days both years hold: ${DASH_FMT.money(tySum)} this year against ${DASH_FMT.money(lySum)} on the same weekdays last year`
    + (lySum ? ` (${DASH_FMT.pct((tySum - lySum) / lySum * 100)})` : '') + '.' + (best ? ` Best day: ${dashDay(best.d)}, ${DASH_FMT.money(best.v)}.` : '')
    + ' Use the left and right arrow keys to read each day.';
  return `<div class="dash-plot" tabindex="0" role="img" aria-label="${dashEsc(aria)}" data-n="${n}">${yl}`
    + `<svg class="dash-svg" viewBox="0 0 ${DASH_CW} ${DASH_CH}" preserveAspectRatio="none" aria-hidden="true">`
    + '<defs><linearGradient id="dashFill" x1="0" y1="0" x2="0" y2="1"><stop class="dash-f1" offset="0"/><stop class="dash-f2" offset="1"/></linearGradient></defs>'
    + grid + (area ? `<path class="dash-area" d="${area}" fill="url(#dashFill)"/>` : '')
    + lyRuns.map(r => `<path class="dash-ly" d="${dashSmooth(r)}"/>`).join('')
    + (line ? `<path class="dash-ty" d="${line}"/>` : '') + (todayP ? `<path class="dash-today" d="${todayP}"/>` : '') + '</svg>'
    + '<div class="dash-cross" aria-hidden="true"><i class="dash-dot is-ty"></i><i class="dash-dot is-ly"></i></div>'
    + `<div class="dash-ctip" role="status" aria-live="polite"></div><div class="dash-xls" aria-hidden="true">${xl}</div></div>`;
}
// The crosshair and its tooltip for day i (or hidden): this year, last year (its own date), and the change.
function dashCross(plot, i) {
  const cross = plot.querySelector('.dash-cross'), tip = plot.querySelector('.dash-ctip');
  const d = dashData('sales');
  const days = dashOk(d) ? d.v.days : null;
  if (i == null || !days || !days[i]) { plot.classList.remove('is-x'); if (tip) tip.textContent = ''; return; }
  const n = days.length, p = days[i];
  const max = dashNice(Math.max(...days.map(x => Math.max(x.v || 0, x.ly || 0))) * 1.08);
  const yp = v => ((DASH_CT + (1 - v / max) * (DASH_CH - DASH_CT)) / DASH_CH * 100).toFixed(2) + '%';
  const left = i / (n - 1) * 100;
  plot.classList.add('is-x');
  cross.style.left = left + '%';
  const [a, b] = cross.querySelectorAll('.dash-dot');
  a.style.top = p.v == null ? '-99px' : yp(p.v);
  b.style.top = p.ly == null ? '-99px' : yp(p.ly);
  const lyDay = sdShift(p.d, -364);
  const pc = p.v != null && p.ly ? (p.v - p.ly) / p.ly * 100 : null;
  tip.innerHTML = `<b>${dashEsc(dashDay(p.d))}${p.d === d.v.today ? ' · so far' : ''}</b>`
    + `<span><i class="dash-k is-ty"></i>This year <b>${p.v == null ? '—' : DASH_FMT.money(p.v)}</b></span>`
    + `<span><i class="dash-k is-ly"></i>Last year · ${dashEsc(dashDay(lyDay))} <b>${p.ly == null ? '—' : DASH_FMT.money(p.ly)}</b></span>`
    + `<span>vs last year <b class="${pc == null ? '' : pc < 0 ? 'is-dn' : 'is-up'}">${pc == null ? '—' : DASH_FMT.pct(pc)}</b></span>`;
  tip.classList.toggle('is-left', left > 60);
  tip.style.left = left + '%';
}
function dashChartWire(el) {
  const plot = el.querySelector('.dash-plot[data-n]');
  if (!plot) return;
  const n = Number(plot.dataset.n);
  let at = null;
  const fromX = x => { const r = plot.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round((x - r.left) / (r.width || 1) * (n - 1)))); };
  plot.addEventListener('pointermove', e => { at = fromX(e.clientX); dashCross(plot, at); });
  plot.addEventListener('pointerleave', () => { if (document.activeElement !== plot) { at = null; dashCross(plot, null); } });
  plot.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      at = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, (at == null ? n - 1 : at) + (e.key === 'ArrowLeft' ? -1 : 1)));
      dashCross(plot, at);
    } else if (e.key === 'Escape') { at = null; dashCross(plot, null); }
  });
  plot.addEventListener('focus', () => { if (at == null) { at = n - 1; dashCross(plot, at); } });
  plot.addEventListener('blur', () => { at = null; dashCross(plot, null); });
}

/* ================= DRAWING ================= */
// The greeting, the date, the brand switch, "Updated".
function dashHeadHtml() {
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = dashWho();
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const brand = (v, t) => `<button type="button" data-dash-brand="${v}" aria-pressed="${DASH.brand === v}">${t}</button>`;
  return `<header class="dash-head"><div><h2 class="dash-hi">${hi}${who ? ', ' + dashEsc(who) : ''}</h2>`
    + `<p class="dash-date">${dashEsc(date)} · <span class="dash-upd"></span></p></div>`
    + `<div class="dash-seg dash-brands" role="group" aria-label="Brand">${brand('SP', 'Ridhi')}${brand('CPC', 'CPC')}${brand('ALL', 'All')}</div></header>`;
}
// Draw these cards. mode 'intro' = the page arriving; 'brand' = another brand picked (numbers count over); 'swap' = new numbers for
// cards already on screen (they count over; a skeleton fades into its number; nothing else moves).
function dashPaint(ids, mode) {
  const eng = DASH.eng || 'none';
  ids.forEach(id => {
    const el = $('dash-' + id);
    if (!el) return;
    dashKill(id);
    let html;
    try { html = DASH_PAINT[id](); } catch (e) { html = '<article class="dash-card"><div class="dash-num is-none">—</div></article>'; }
    const was = DASH.was[id];
    DASH.was[id] = /dash-sk/.test(html) ? 'sk' : html ? 'ok' : 'none';
    el.classList.toggle('is-empty', !html);
    el.innerHTML = html;
    try { dashAnim(id, el, mode, eng, was); } catch (e) { /* shown as it is */ }
    try { dashChartWire(el); } catch (e) { /* the chart is there anyway */ }
  });
  const small = document.querySelector('#paneDash .dash-smalls');
  if (small) small.dataset.n = String(small.querySelectorAll('.dash-slot:not(.is-empty)').length);
}
// The whole page.
function dashRender() {
  const root = $('dashRoot');
  if (!root) return;
  dashKillAll();
  dashStop();
  DASH.memo = {};
  DASH.shown = {};
  DASH.was = {};
  DASH.drawn = {};
  const eng = DASH.eng = dashEngine();
  $('paneDash').classList.toggle('dash-fx', eng === 'css');
  $('paneDash').classList.toggle('dash-gs', eng === 'gsap');
  const slot = id => `<div class="dash-slot" id="dash-${id}"></div>`;
  root.innerHTML = dashHeadHtml() + slot('summary')
    + `<section class="dash-kpis" aria-label="Key numbers">${['kMtd', 'kYest', 'kAds', 'kYtd'].map(slot).join('')}</section>`
    + slot('chart')
    + `<section class="dash-smalls">${['cVi', 'cNew', 'cWins'].map(slot).join('')}</section>`;
  DASH.rendered = true;
  dashUpdated();
  dashPaint(DASH_SLOTS, 'intro');
}
// "Updated HH:MM" — the time of the newest number that arrived (amber "Showing saved numbers" until one does).
function dashUpdated() {
  const el = document.querySelector('#paneDash .dash-upd');
  if (!el) return;
  const busy = Object.values(DASH.st).some(s => s.s === 'loading');
  el.textContent = DASH.lastFresh ? 'Updated ' + dashHm(DASH.lastFresh) + (busy ? ' · updating…' : '') : busy ? 'Loading…' : 'Showing saved numbers';
  el.classList.toggle('is-old', !DASH.lastFresh);
}

/* ================= MOTION — GSAP, else CSS; nothing when ✨ is off ================= */
const dashScript = src => new Promise(resolve => {
  try {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  } catch (e) { resolve(false); }
});
// GSAP, fetched once, the first time the Dashboard opens with ✨ on (the Sales Dashboard reuses it). true = ready.
function dashGsap() {
  if (window.gsap && DASH.gs === true) return Promise.resolve(true);
  if (!DASH.gsTry) DASH.gsTry = (async () => {
    const ok = window.gsap || await dashScript(DASH_CDN + 'gsap.min.js');
    if (!ok || !window.gsap) { DASH.gs = false; return false; }
    try { window.gsap.config({ nullTargetWarn: false }); DASH.gs = true; } catch (e) { DASH.gs = false; }
    return DASH.gs;
  })();
  return DASH.gsTry;
}
const dashTw = (id, t) => { if (t) (DASH.tw[id] || (DASH.tw[id] = [])).push(t); return t; };
// Stop a card's animations and leave every element as it is meant to look (no half-drawn line, no half-faded text).
function dashKill(id) {
  (DASH.tw[id] || []).forEach(t => { try { t.progress(1).kill(); } catch (e) { /* gone */ } });
  DASH.tw[id] = [];
}
const dashKillAll = () => Object.keys(DASH.tw).forEach(dashKill);
// One card: its numbers, and (GSAP) its entrance: the line fades in, trend lines and the chart draw — once per page (DASH.drawn).
function dashAnim(id, el, mode, eng, was) {
  dashNumbers(id, el, mode, eng);
  if (eng === 'none') return;
  const first = !DASH.drawn[id] && DASH.was[id] === 'ok';
  if (DASH.was[id] === 'ok') DASH.drawn[id] = true;
  const reveal = mode === 'swap' && was === 'sk';
  if (eng === 'css') {
    el.classList.remove('is-in', 'is-draw');
    if (first || reveal) { void el.offsetWidth; el.classList.add('is-in'); if (first) el.classList.add('is-draw'); }
    return;
  }
  const g = window.gsap;
  const i = DASH_SLOTS.indexOf(id);
  const delay = mode === 'intro' ? 0.06 * i : 0;
  if (id === 'summary' && (first || reveal)) dashTw(id, g.fromTo(el.querySelector('.dash-sum-box'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', delay: 0.05, clearProps: 'opacity,transform' }));
  else if (reveal) dashTw(id, g.fromTo(el.firstElementChild, { opacity: 0.4 }, { opacity: 1, duration: 0.45, ease: 'power1.out', clearProps: 'opacity' }));
  if (!first) return;
  // a line draws from left to right: its picture is uncovered (a clip), whatever the stroke or the card's width
  el.querySelectorAll('svg.dash-spark, .dash-svg').forEach(p => dashTw(id, g.fromTo(p, { clipPath: 'inset(0% 100% 0% 0%)' },
    { clipPath: 'inset(0% 0% 0% 0%)', duration: p.classList.contains('dash-svg') ? 1.3 : 0.9, ease: 'power2.inOut', delay: delay + 0.15, clearProps: 'clipPath' })));
  el.querySelectorAll('.dash-area, .dash-ly, .dash-today').forEach(p => dashTw(id, g.fromTo(p, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power1.out', delay: delay + 0.5, clearProps: 'opacity' })));
  const bars = el.querySelectorAll('.dash-bar');
  if (bars.length) dashTw(id, g.fromTo(bars, { scaleY: 0 }, { scaleY: 1, transformOrigin: '50% 100%', duration: 0.6, ease: 'power2.out', stagger: 0.04, delay: delay + 0.1, clearProps: 'transform' }));
}
// The numbers: from 0 on arrival (or from what was on screen for a brand change / new data), always ending on the exact text.
function dashNumbers(id, el, mode, eng) {
  el.querySelectorAll('[data-cu]').forEach(n => {
    const v = Number(n.dataset.cu), fmt = DASH_FMT[n.dataset.fmt], k = n.dataset.k;
    const prev = k in DASH.shown ? DASH.shown[k] : null;
    DASH.shown[k] = v;
    if (!fmt || eng === 'none') return;
    const from = mode === 'intro' || prev == null ? 0 : prev;
    if (from === v) return;
    const end = n.textContent;
    const delay = mode === 'intro' ? 120 + 60 * Math.max(0, DASH_SLOTS.indexOf(id)) : 0;
    if (eng === 'gsap') {
      const o = { x: from };
      n.textContent = fmt(from);
      dashTw(id, window.gsap.to(o, { x: v, duration: mode === 'intro' ? 1.1 : 0.7, ease: 'power3.out', delay: delay / 1000,
        onUpdate: () => { n.textContent = fmt(o.x); }, onComplete: () => { n.textContent = end; } }));
      return;
    }
    n.textContent = fmt(from);
    DASH.cu.push({ el: n, from, v, fmt, end, t0: performance.now() + delay });
  });
  if (DASH.cu.length && !DASH.raf) DASH.raf = requestAnimationFrame(dashTick);
  // the safety net: whatever happens to the frames or the tweens, every number shows its exact text within 3 s
  clearTimeout(DASH.safety);
  DASH.safety = setTimeout(() => { dashStop(); dashKillAll(); }, 3000);
}
function dashTick(t) {
  DASH.raf = 0;
  DASH.cu = DASH.cu.filter(x => {
    if (!x.el.isConnected) return false;
    const p = Math.min(1, Math.max(0, (t - x.t0) / 800));
    if (p >= 1) { x.el.textContent = x.end; return false; }
    x.el.textContent = x.fmt(x.from + (x.v - x.from) * (1 - Math.pow(1 - p, 3)));
    return true;
  });
  if (DASH.cu.length) DASH.raf = requestAnimationFrame(dashTick);
}
// Stop the CSS-mode counting: every number its exact text, now.
function dashStop() {
  if (DASH.raf) cancelAnimationFrame(DASH.raf);
  DASH.raf = 0;
  DASH.cu.forEach(x => { x.el.textContent = x.end; });
  DASH.cu = [];
  clearTimeout(DASH.safety);
}

/* ================= OPENING A SCREEN FROM A CARD ================= */
// Listing Health opens on "New (N days)" (or the level asked for), for the brand on view, on Child listings, newest first.
function dashOpen(tab, level) {
  if (!dashMay(tab)) return;
  if (tab === 'health') {
    const pick = (id, v) => { const el = $(id); if (el && [...el.options].some(o => o.value === v)) { el.value = v; return true; } return false; };
    pick('hBrandView', DASH.brand);
    if (level && pick('hIssueView', level) && /^new\d+$/.test(level)) {
      if (typeof LI_WS !== 'undefined' && LI_WS.on && $('hViewChild')) $('hViewChild').click();   // out of the Workspace, onto the table
      if ($('hFilter')) $('hFilter').value = '';
      if (typeof H_FOCUS !== 'undefined') H_FOCUS = null;
      if (typeof H_VIEW !== 'undefined') H_VIEW = 'child';
      if (typeof H_SORT !== 'undefined') H_SORT = { k: 'nlDays', dir: 1 };
    }
    if (typeof renderHealth === 'function' && typeof H_LOADED !== 'undefined' && H_LOADED) { try { renderHealth(); } catch (e) { /* drawn when it opens */ } }
  }
  showTab(tab);
}

/* ================= THE SCREEN, THE SWITCH, THE LOGO, SIGN-IN ================= */
// Opening the Dashboard: drawn at once (fresh, cached or skeleton cards); the loads already running fill it as they land. The first
// time with ✨ on, GSAP is fetched — waited for at most 300 ms, after which the CSS motion is used for this drawing.
async function ensureDash() {
  if (!DASH_READY) return;
  dashPrefetch();
  if (dashFxOn() && DASH.gs == null) await Promise.race([dashGsap(), dashSleep(300)]);
  if ($('paneDash').classList.contains('hide')) return;
  try { dashRender(); } catch (e) { /* the page stays as it was */ }
}
(() => {
  try {
    const saved = dashGet(DASH_LS.brand);
    if (saved === 'ALL' || saved === 'SP' || saved === 'CPC') DASH.brand = saved;
    const nl = Number(dashGet(DASH_LS.nl));
    if (NL_WINDOWS.includes(nl)) DASH.nlDays = nl;
  } catch (e) { /* All, 30 days */ }
  const pane = $('paneDash');
  if (pane) pane.addEventListener('click', e => {
    const b = e.target.closest('[data-dash-brand]');
    if (b) {
      if (DASH.brand === b.dataset.dashBrand) return;
      DASH.brand = b.dataset.dashBrand;
      dashSet(DASH_LS.brand, DASH.brand);
      pane.querySelectorAll('[data-dash-brand]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      dashPaint(DASH_SLOTS, 'brand');
      return;
    }
    const w = e.target.closest('[data-dash-nl]');
    if (w) {
      const n = Number(w.dataset.dashNl);
      if (n === DASH.nlDays) return;
      DASH.nlDays = n;
      dashSet(DASH_LS.nl, String(n));
      dashPaint(['cNew'], 'brand');
      const again = pane.querySelector(`[data-dash-nl="${n}"]`);
      if (again) again.focus({ preventScroll: true });
      return;
    }
    const o = e.target.closest('[data-dash-open]');
    if (o && !o.disabled) dashOpen(o.dataset.dashOpen, o.dataset.dashLevel || '');
  });
  // another screen, or the tab hidden: every animation ends where it was going (nothing keeps running unseen)
  const settle = () => { if (!dashShown() || document.visibilityState === 'hidden') { dashStop(); dashKillAll(); } };
  if (pane && typeof MutationObserver === 'function') new MutationObserver(settle).observe(pane, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', settle);
  // ✨: aria-pressed = the choice; the title also says when the computer's reduced-motion setting keeps it still.
  const btn = $('fxBtn');
  const sync = () => {
    if (!btn) return;
    const on = dashFxSaved();
    btn.setAttribute('aria-pressed', String(on));
    btn.title = 'Animation (Dashboard and Sales): ' + (on ? (dashReduce() ? 'on, but your computer asks for reduced motion' : 'on') : 'off');
  };
  if (btn) btn.addEventListener('click', async () => {
    dashSet(DASH_LS.fx, dashFxSaved() ? '0' : '1');
    sync();
    if (!dashShown()) return;
    if (dashFxOn() && DASH.gs == null) await Promise.race([dashGsap(), dashSleep(300)]);
    dashRender();
  });
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { sync(); if (dashShown()) dashRender(); });
  } catch (e) { /* the setting is read again on every draw */ }
  sync();
  // The Sellora logo opens the Dashboard (the menu's close button beside it keeps its own job).
  document.querySelectorAll('#sideNav .brandtile, #sideNav .brandname').forEach(el => el.addEventListener('click', () => {
    if (dashMay('dash')) showTab('dash');
  }));
  // SIGN-IN: the loads start as soon as the account's rights are known (core/access.js applyPerms), whatever screen opens first.
  try {
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      DASH.t0 = performance.now();
      const email = String(user.email || '').toLowerCase();
      for (let i = 0; i < 300 && !(ME.email === email && dashMay('dash')); i++) await dashSleep(25);
      dashPrefetch();
    });
  } catch (e) { /* the loads then start when the Dashboard opens */ }
  DASH_READY = true;
})();
