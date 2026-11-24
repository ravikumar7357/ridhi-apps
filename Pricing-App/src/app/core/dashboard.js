/* ================= CORE · DASHBOARD: the first screen after sign-in (20–21 Nov 2026) =================
 * Screens: Dashboard (tab 'dash', #paneDash; core/nav.js calls ensureDash when it opens), the Sellora logo in the top bar (opens
 *          it) and the ✨ button beside the theme switch (#fxBtn: the animation on / off for the Dashboard and the Sales Dashboard —
 *          sales/sales-charts.js reads the same choice, selloraDashFx; nothing on any other screen moves or stops with it).
 * Does: shows, for Both / Ridhi / CPC (remembered in this browser), the numbers the other screens work out — never one of its own.
 *   NEVER EMPTY: every card first shows the number it showed last time (this browser's copy, selloraDash.v3, amber "as of <time>"),
 *   then counts over to the fresh number when that lands. The very first time, a shimmer stands in, and morphs into the number.
 *   THE LOADS START WHEN SIGN-IN SUCCEEDS (dashPrefetch, from this file's own onAuthStateChanged — core/auth.js is not touched), all
 *   at once, each card on its own (15 s each, then the cached number or "couldn't load"): Sales · PPC · Inventory, then Listing
 *   Health, then pictures · errors · BSR · Listing History. Each reads what its screen reads, read-only, and data a screen already
 *   holds is used as it is:
 *     sales    the Sales Dashboard's own loader (ensureSales) and sums (sdSum, sdSeries) — its numbers and its date, to the cent;
 *     ads      the PPC & Organic weekly store (WEEKLY, else ONE read of its saved snapshot into the Dashboard's OWN copy);
 *     age      Inventory Age's saved snapshot (loadAgeCache);
 *     health   EXACTLY what Listing Health's header counts (renderHealthKpis): its snapshot (loadHealthCache), its rules (lrLoad),
 *              catalogue (only a fresh saved copy — lrLoadCatalog WRITES a new one otherwise), Amazon's status (amzEnsure), the
 *              picture list (imListLoad), the picture-check marks (pcLoad), the shared copy of live reads (svLoad) and the listing
 *              cache's first refresh — then hCtx + hHealthKept, the header's own judgement, with Monitor counted on its own. Any of those
 *              changing later (dashWatch: hCtx, LI_WS.liveV …) counts again. A self-check (dashHealthCheck) compares the Dashboard
 *              with the header each time Listing Health draws it, and logs any difference in the console;
 *     img/lerr Image Manager's list (IML) — "need pictures" (imProblems · IM_NEEDS) and Listing Errors' "Errors only" count;
 *     bsr      BSR Audit's "Got worse" (its compare when drawn, else the latest two stored weeks through its own functions);
 *     lh       Listing History, this month and last month (LH.rows when loaded, else the newest LISTING log documents — up to the 800
 *              the screen reads — until last month is covered).
 * NEVER: an Amazon refresh, "Refresh both brands", "Refresh from Amazon", AI, or a write anywhere but this browser (localStorage).
 * Look: GSAP 3.12.5 + ScrollTrigger + MotionPathPlugin (jsDelivr, fetched the first time the Dashboard opens with ✨ on): an aurora
 *       behind, a slow dot field, the greeting typed in, a live clock, a sliding brand pill, glass KPI cards with sparklines, tilt, a
 *       rotating rim and a shine, a flow of glowing pipes with dots running through them, donuts that draw segment by segment and pop on
 *       hover, a line that draws with a rider dot and a crosshair, elastic bars with a striped running week, tiles that reveal on
 *       scroll, a ticker of what needs attention, and confetti once a day for a real win. No GSAP: the CSS motion. ✨ off / reduced
 *       motion: no motion at all (GSAP not fetched), same numbers. Every loop stops while the tab is hidden or another screen is open.
 * Main functions: ensureDash, dashPrefetch, dashRun, dashWatch, dashHealthCheck, dashData, dashRender, dashPaint, dashAnim. */

// var, not const: core/nav.js's load-time showTab calls ensureDash before this file has run (it waits for this).
var DASH_READY = false;
const DASH_LS = { brand: 'selloraDashBrand', fx: 'selloraDashFx', cache: 'selloraDash.v3', old: 'selloraDash.v2', party: 'selloraDashConfetti' };
const DASH_CDN = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/';
const DASH_TIMEOUT = 15000;
const DASH = { brand: 'ALL', st: {}, memo: {}, sigUsed: {}, shown: {}, was: {}, tw: {}, timing: {}, t0: 0, weekly: null, lhOwn: null,
  bsrOwn: null, catOk: {}, imlP: null, gs: null, plug: {}, eng: 'none', cu: [], raf: 0, safety: 0, rendered: false, lastFresh: 0,
  dots: null, clockT: 0, watchT: 0, paused: false };
const DASH_NUM = new Intl.NumberFormat('en-US');
const DASH_FMT = {
  money: v => '$' + DASH_NUM.format(Math.round(v)),         // the Sales Dashboard's sdMoney: whole dollars
  usd2: v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),   // Inventory Age's storage
  num: v => DASH_NUM.format(Math.round(v)),
};
const DASH_SLOTS = ['ticker', 'tVi', 'kSales', 'kYtd', 'kAds', 'kList', 'flow', 'donut', 'line', 'bars', 'tImg', 'tErr', 'tBsr', 'tAge'];
// Each data source: the screen whose access it needs, and the cards it fills.
const DASH_KEYS = {
  sales: { tab: 'sales', slots: ['kSales', 'kYtd', 'line', 'ticker'] },
  ads: { tab: 'ppcn', slots: ['kAds', 'bars', 'ticker'] },
  vi: { tab: 'sales', slots: ['tVi'] },                 // This week in plain English (sales/sales-insight.js)
  age: { tab: 'age', slots: ['tAge', 'ticker'] },
  health: { tab: 'health', slots: ['kList', 'flow', 'donut', 'ticker'] },
  lh: { tab: 'lhist', slots: ['flow'] },
  img: { tab: 'img', slots: ['tImg', 'ticker'] },
  lerr: { tab: 'lerr', slots: ['tErr', 'ticker'] },
  bsr: { tab: 'bsr', slots: ['tBsr', 'ticker'] },
};
const DASH_VIEWS = ['ALL', 'SP', 'CPC'];
const DASH_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
const dashPhone = () => dashMq('(max-width:700px)') || dashMq('(pointer:coarse)');
const dashFxSaved = () => dashGet(DASH_LS.fx) !== '0';
const dashFxOn = () => dashFxSaved() && !dashReduce();
// How the Dashboard moves right now: 'gsap', 'css' (GSAP not loaded), or 'none' (✨ off / reduced motion).
const dashEngine = () => (!dashFxOn() ? 'none' : window.gsap && DASH.gs === true ? 'gsap' : 'css');
const dashShown = () => !!$('paneDash') && !$('paneDash').classList.contains('hide');
const dashLive = () => dashShown() && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
const dashMs = () => Math.round(performance.now() - (DASH.t0 || 0));

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
// v2 kept Listing Health / pictures / history numbers worked out before the inputs were all in: only its sales, PPC and age come over.
(() => {
  try {
    if (dashGet(DASH_LS.cache)) return;
    const old = JSON.parse(dashGet(DASH_LS.old) || 'null');
    if (!old) return;
    const keep = {};
    ['sales', 'ads', 'age'].forEach(k => { if (old[k]) keep[k] = old[k]; });
    dashSet(DASH_LS.cache, JSON.stringify(keep));
  } catch (e) { /* starts empty */ }
})();
// Keep a source's fresh numbers for all three views (Both, Ridhi, CPC), so the next sign-in shows them at once.
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
  sales: () => [SD && SD.at, SD && SD.d, SD_LIVE, typeof T_MATCH !== 'undefined' && T_MATCH.biz],
  ads: () => [WEEKLY.rows, WEEKLY.at, DASH.weekly],
  vi: () => [typeof VI !== 'undefined' ? VI.v : 0, typeof sdToday === 'function' ? sdToday() : '', H_LOADED],
  age: () => [AGE_LOADED, AGE.SP, AGE.CPC],
  health: () => [H_LOADED, LR, HEALTH.SP, HEALTH.CPC, H_LOADED && LR ? hCtx() : null, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, new Date().toDateString()],
  lh: () => [LH.rows, LH.loading, DASH.lhOwn],
  img: () => [IML.SP, IML.CPC, IML.SP && IML.SP.items, IML.CPC && IML.CPC.items, typeof lmVersion === 'function' ? lmVersion() : 0, typeof PC !== 'undefined' ? PC.v : 0],
  lerr: () => [IML.SP, IML.CPC, IML.SP && IML.SP.items, IML.CPC && IML.CPC.items, typeof lmVersion === 'function' ? lmVersion() : 0],
  bsr: () => [BSR_RENDER && BSR_RENDER.all, DASH.bsrOwn],
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
  // The Sales Dashboard's own sums: sdSum / sdSeries read the channel on view (SD_CH), so it is set for each brand and put back
  // straight after, in the same moment (nothing else runs in between).
  sales: () => {
    if (!(SD && SD.at)) return null;
    const keep = SD_CH;
    const today = sdToday(), yest = sdShift(today, -1);
    const monthStart = today.slice(0, 8) + '01', yearStart = today.slice(0, 4) + '-01-01';
    const T = typeof T_MATCH !== 'undefined' && T_MATCH.biz;
    const when = 'nightly run ' + SD.at + (SD_LIVE ? ' · today ' + SD_LIVE : '') + (T ? ' · Seller Central totals' : '');
    try {
      return dashPerView(view => {
        const bs = dashBrandsOf(view);
        const sum = (from, to) => bs.reduce((t, ch) => { SD_CH = ch; return t + sdSum(from, to)[0]; }, 0);
        const series = from => {
          const by = {};
          bs.forEach(ch => { SD_CH = ch; sdSeries(from, today).forEach(p => { by[p.d] = (by[p.d] || 0) + p.v; }); });
          return Object.keys(by).sort().map(d => ({ d, v: Math.round(by[d] * 100) / 100 }));
        };
        const pts = series(sdShift(today, -89));
        const months = [];
        for (let m = 1; m <= Number(today.slice(5, 7)); m++) {
          const mm = String(m).padStart(2, '0');
          months.push(sum(`${today.slice(0, 4)}-${mm}-01`, new Date(Date.UTC(Number(today.slice(0, 4)), m, 0)).toISOString().slice(0, 10)));
        }
        return { mtd: sum(monthStart, today), ytd: sum(yearStart, today),
          mc: sum(monthStart, yest), ml: sum(sdLastYear(monthStart), sdLastYear(yest)),
          yc: sum(yearStart, yest), yl: sum(sdLastYear(yearStart), sdLastYear(yest)),
          pts, spark30: pts.slice(-30).map(p => p.v), months, day: SD.at, when };
      });
    } finally { SD_CH = keep; }
  },
  // PPC & Organic: per week of the last 8, sales and ad spend; the latest week's TACoS as renderWeeklyKpis works it out.
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
      const last = per[per.length - 1];
      return { per, last, tacos: last && last.rev ? Math.round(last.spend / last.rev * 100) : null, days: last && !last.done ? wDaysIn(last.w) : 7,
        only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: (W.at ? 'sales as at ' + W.at : 'not pulled yet') + (W.adAt ? ' · ads ' + W.adAt : '') };
    });
  },
  // Inventory Age: aged 181+ units and the storage charge, as renderAgeKpis adds them up.
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
  // Listing Health's header (renderHealthKpis): every listing of the snapshot, judged by hHealthKept with hCtx, counted by its level.
  health: () => {
    const per = dashHealthCounts();
    if (!per) return null;
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => per[b]);
      if (!bs.length) return { empty: true, when: 'no snapshot yet' };
      const v = { n: 0, critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0 };
      bs.forEach(b => Object.keys(v).forEach(k => { v[k] += per[b][k]; }));
      const whens = [...new Set(bs.map(b => per[b].when))];
      return Object.assign(v, { per: Object.fromEntries(bs.map(b => [b, per[b]])),
        when: whens.length === 1 ? whens[0] : bs.map(b => dashName(b) + ': ' + per[b].when).join(' · ') });
    });
  },
  // Listing History: listings sent after approval, and listings Amazon accepted — this month and last month.
  lh: () => {
    const rows = Array.isArray(LH.rows) && !LH.loading && !LH.err ? LH.rows : DASH.lhOwn;
    if (!rows) return null;
    const blank = { from: '', to: '', user: '', what: '', screen: '', result: '', q: '' };
    const month = lhFiltered(rows, Object.assign({}, blank, { range: 'month' }));
    const d = new Date();
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const prev = lhFiltered(rows, Object.assign({}, blank, { range: 'custom', from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
      to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) }));
    const count = (list, bs) => {
      const mine = list.filter(r => bs.includes(r.brand));
      return { fixed: new Set(mine.filter(r => r.result !== 'notsent').map(r => r.brand + '|' + r.sku)).size,
        amz: new Set(mine.filter(r => r.result === 'accepted').map(r => r.brand + '|' + r.sku)).size };
    };
    return dashPerView(view => {
      const bs = dashBrandsOf(view);
      const now = count(month, bs), was = count(prev, bs);
      return { fixed: now.fixed, amz: now.amz, fixedPrev: was.fixed, amzPrev: was.amz, when: 'Listing History · ' + DASH_MON[d.getMonth()] };
    });
  },
  img: () => dashImlCount(it => it.lvl !== 'parent', (it, b) => imProblems(it, b).some(k => IM_NEEDS.includes(k))),
  lerr: () => dashImlCount(x => x.lvl !== 'parent', x => (x.iss || []).some(i => i.s === 'E') || (!!x.ie && !x.iss)),
  // BSR Audit's "Got worse": its compare as drawn (the weeks picked there), else the latest two stored weeks worked out here.
  bsr: () => {
    const all = BSR_LOADED && BSR_RENDER && Array.isArray(BSR_RENDER.all) && BSR_RENDER.all.length ? BSR_RENDER.all : null;
    if (all) {
      const pick = $('bBrandView') ? $('bBrandView').value : 'ALL';
      const wA = $('bWeekA') ? $('bWeekA').value : '', wB = $('bWeekB') ? $('bWeekB').value : '';
      return dashPerView(view => {
        const bs = dashBrandsOf(view);
        if (pick !== 'ALL' && bs.some(b => b !== pick)) return null;
        const worse = all.filter(r => bs.includes(r.brand) && r.move === 'worse');
        return { n: worse.length, high: worse.filter(r => r.prio && r.prio.p === 'High').length, when: wA && wB ? wA + ' vs ' + wB : 'BSR Audit' };
      });
    }
    const own = DASH.bsrOwn;
    if (!own) return null;
    return dashPerView(view => (own.none ? { empty: true, when: 'no snapshots yet' }
      : { n: dashBrandsOf(view).reduce((s, b) => s + (own[b] || 0), 0), high: null, when: own.wA + ' vs ' + own.wB }));
  },
};
// Listing Health's header numbers per brand — renderHealthKpis' tally over renderHealth's rows: each snapshot row copied with its brand,
// judged by hHealthKept(snapshot row, copy, hCtx(), now). null until every input Listing Health judges with is in.
function dashHealthCounts() {
  if (!H_LOADED || !LR) return null;
  if (['SP', 'CPC'].some(b => HEALTH[b] && !LR_CAT[b] && !DASH.catOk[b])) return null;      // its catalogue: not in, and not fresh
  if (hColdMany()) { dashWarmHealth(); return null; }                                         // new rows (a refresh): judged in slices first
  const hc = hCtx();
  const now = Date.now();
  const per = {};
  ['SP', 'CPC'].forEach(brand => {
    if (!HEALTH[brand]) return;
    const c = { n: 0, critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0, nodata: 0 };
    HEALTH[brand].rows.forEach(src => {
      const row = { ...src, brand };
      const h = hHealthKept(src, row, hc, now);
      c.n++;
      if (h.bucket in c) c[h.bucket]++;
      if (h.bucket === 'unchecked' && row.tried) c.nodata++;
    });
    const lm = typeof lmDataLabel === 'function' ? lmDataLabel([brand]) : null;
    c.when = lm ? lm.text : HEALTH[brand].at ? 'updated ' + dashWhen(HEALTH[brand].at) : '';
    per[brand] = c;
  });
  return per;
}
// Many listings not judged yet (a refresh brought new rows): Listing Health's own slices (hWarm), then counted again and kept.
function dashWarmHealth() {
  if (DASH.warmP) return;
  DASH.warmP = Promise.resolve(hWarm()).catch(() => {}).then(() => {
    DASH.warmP = null;
    delete DASH.memo.health;
    if (dashCalc('health')) { dashStore('health'); DASH.lastFresh = Date.now(); }
    if (dashShown() && DASH.rendered) { dashPaint([...new Set(DASH_KEYS.health.slots)], 'swap'); dashLiveLine(); }
  });
}
// Image Manager's list (IML), counted per brand: the child listings `kid` keeps for which `hit` is true.
function dashImlCount(kid, hit) {
  if (!['SP', 'CPC'].every(b => b in IML)) return null;
  const per = {};
  ['SP', 'CPC'].forEach(b => {
    const data = IML[b];
    if (data && Array.isArray(data.items)) per[b] = { n: data.items.filter(it => kid(it) && hit(it, b)).length,
      when: (typeof lmDataLabel === 'function' && lmDataLabel([b])) ? lmDataLabel([b]).text : data.at ? 'snapshot ' + dashWhen(data.at) : '' };
  });
  return dashPerView(view => {
    const bs = dashBrandsOf(view).filter(b => per[b]);
    if (!bs.length) return { empty: true, when: 'no snapshot yet' };
    const whens = [...new Set(bs.map(b => per[b].when))];
    return { n: bs.reduce((s, b) => s + per[b].n, 0), only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
      when: whens.length === 1 ? whens[0] : bs.map(b => dashName(b) + ': ' + per[b].when).join(' · ') };
  });
}

/* ================= THE SELF-CHECK: the Dashboard against Listing Health's own header ================= */
// Each time Listing Health draws its header showing every listing (no level, no search), its numbers are read off the page and set
// beside the Dashboard's, worked out at that moment from the same data. A difference is logged (console.warn) and counted again.
function dashHealthCheck() {
  const box = $('hKpis');
  if (!box) return { checked: false, why: 'no header' };
  if (($('hIssueView') || {}).value !== 'ALL' || String(($('hFilter') || {}).value || '').trim()) return { checked: false, why: 'a filter is on' };
  const screen = {};
  box.querySelectorAll('.lh-kpibrand').forEach(card => {
    const name = ((card.querySelector('.lh-kpiname') || {}).textContent || '').trim();
    const brand = name === 'Ridhi' ? 'SP' : name === 'CPC' ? 'CPC' : '';
    if (!brand) return;
    const v = {};
    card.querySelectorAll('.ls-box').forEach(b => {
      const label = ((b.querySelector('.ls-l') || {}).textContent || '').replace(/[●▲✓]/g, '').trim();
      const num = Number(((b.querySelector('.ls-v b') || {}).textContent || '').replace(/[^\d.-]/g, ''));
      const note = (b.querySelector('.ls-note') || {}).textContent || '';
      if (label === 'Critical') v.critical = num;
      else if (label === 'Needs Action') v.action = num;
      else if (label === 'Needs Review') v.review = num;
      else if (label === 'Healthy') { v.healthyAll = num; const m = note.match(/([\d,]+)\s+monitor/); v.monitor = m ? Number(m[1].replace(/,/g, '')) : 0; }
      else if (label === 'Listings') v.n = num;
    });
    screen[brand] = v;
  });
  delete DASH.memo.health;
  const per = dashHealthCounts();
  if (!per) return { checked: false, why: 'the Dashboard has not every input yet', screen };
  const out = { checked: true, same: true, brands: {} };
  Object.keys(screen).forEach(b => {
    const s = screen[b], d = per[b];
    if (!d || s.n !== HEALTH[b].rows.length) return;                    // the header is not showing every listing of the brand
    const mine = { n: d.n, critical: d.critical, action: d.action, review: d.review, healthyAll: d.healthy + d.monitor, monitor: d.monitor };
    const same = Object.keys(mine).every(k => mine[k] === s[k]);
    out.brands[b] = { same, dashboard: mine, listingHealth: s };
    if (!same) out.same = false;
  });
  if (!out.same) {
    console.warn('[Dashboard] Listing Health numbers differ from the Listing Health header — counting again', out.brands);
    dashChanged('health');
  }
  if (Object.keys(out.brands).length && out.same) dashStore('health');
  return out;
}
if (typeof window !== 'undefined') window.dashHealthCheck = dashHealthCheck;   // in the console: dashHealthCheck()

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
async function dashLoadAge() { if (!AGE_LOADED) await loadAgeCache(); }
// Image Manager's list for both brands — once, shared by Listing Health, Need pictures and Errors (never the Amazon read).
function dashLoadIml() {
  if (!DASH.imlP) DASH.imlP = Promise.all(['SP', 'CPC'].filter(b => !(b in IML)).map(b => Promise.resolve(imListLoad(b)).catch(() => {})));
  return DASH.imlP;
}
// The catalogue Listing Health judges with: taken only when its saved copy is fresh (under a day) — exactly what lrLoadCatalog does
// then. An old copy is left alone: lrLoadCatalog would read the workbook and WRITE a new copy, which the Dashboard never does.
async function dashCatalog() {
  for (const b of ['SP', 'CPC']) {
    if (LR_CAT[b]) continue;
    const snap = await getDoc(doc(db, 'listingrules', 'catalog_' + b));
    const data = snap.exists() ? snap.data() : null;
    const fresh = data && data.at && data.at.toDate && Date.now() - data.at.toDate().getTime() < 24 * 3600 * 1000;
    if (data && data.map && fresh) { LR_CAT[b] = data.map; DASH.catOk[b] = true; H_CTX = null; }
  }
}
// Listing Health: every input its header is judged with — the same loaders it (and Image Manager / the sync at sign-in) uses.
async function dashLoadHealth() {
  await dashApi();
  const jobs = [];
  if (!LR) jobs.push(lrLoad());
  jobs.push(dashCatalog());
  if (!AMZ.map) jobs.push(amzEnsure());
  jobs.push(dashLoadIml());
  if (!H_LOADED) jobs.push(loadHealthCache());
  if (typeof pcLoad === 'function') jobs.push(pcLoad());                  // the picture-check marks ("Main not OK")
  if (typeof svLoad === 'function') jobs.push(svLoad());                  // the shared copy of the live reads
  await Promise.all(jobs.map(p => Promise.resolve(p).catch(() => {})));
  // the listing cache's first refresh (started just after its browser copy is read), and a screen's amzEnsure still running
  await dashSleep(0);
  if (typeof LM !== 'undefined' && LM.busy) await Promise.race([Promise.resolve(LM.busy).catch(() => {}), dashSleep(10000)]);
  for (let i = 0; i < 200 && AMZ.busy; i++) await dashSleep(50);
  H_CTX = null;
  if (hColdMany()) await hWarm();
  if (['SP', 'CPC'].some(b => HEALTH[b] && !LR_CAT[b] && !DASH.catOk[b])) throw new Error('the catalogue copy is over a day old — open Listing Health to update it');
}
// Listing History, this month and last: the newest log documents of the shared /history collection — more while the oldest LISTING
// document read is still inside last month, up to the 800 the Listing History screen reads (other apps' documents carry a day too).
async function dashLoadLh() {
  if (Array.isArray(LH.rows) && !LH.loading && !LH.err) return;
  const d = new Date();
  const fromDay = new Date(d.getFullYear(), d.getMonth() - 1, 1, -24).toISOString().slice(0, 10);   // a day early: the log's day is UTC
  for (let n = 60; ; n = Math.min(n * 2, LH_DOCS)) {
    const snap = await getDocs(query(collection(db, 'history'), orderBy('day', 'desc'), limit(n)));
    const rows = [];
    let count = 0, oldest = '';
    snap.forEach(docSnap => {
      count++;
      const data = docSnap.data() || {};
      if (!/^listing_/.test(docSnap.id) || data.kind !== 'listing') return;
      if (data.day && (!oldest || data.day < oldest)) oldest = data.day;
      Object.values(data.rows || {}).forEach(row => { if (row && row.kind === 'listing') rows.push(row); });
    });
    if (count < n || (oldest && oldest < fromDay) || n >= LH_DOCS) { DASH.lhOwn = rows; return; }
  }
}
// BSR Audit: its compare when drawn; else the latest two stored weeks (as its week pickers default) through its own functions.
async function dashLoadBsr() {
  if (BSR_LOADED && BSR_RENDER && Array.isArray(BSR_RENDER.all) && BSR_RENDER.all.length) return;
  if (!BSR_LOADED) await loadBsrCache();
  const weeks = allWeeks();
  if (!weeks.length) { DASH.bsrOwn = { none: true }; return; }
  const wA = weeks[weeks.length - 1], wB = weeks[weeks.length - 2] || wA;
  const own = { wA, wB };
  for (const b of ['SP', 'CPC']) {
    if (BSR_WEEKS[b].includes(wA)) await loadBsrWeek(b, wA);
    if (BSR_WEEKS[b].includes(wB)) await loadBsrWeek(b, wB);
    await bsrLoadDays(b, wA);
    await bsrLoadDays(b, wB);
    const A = bsrWeekEntries(b, wA).r, B = bsrWeekEntries(b, wB).r;
    let n = 0;
    new Set([...Object.keys(A), ...Object.keys(B)]).forEach(p => {
      const ea = A[p], eb = B[p];
      const used = bsrUsed(ea, eb);
      const catChanged = used.kind === 'sub' ? !!(ea && ea.subCat && eb && eb.subCat && ea.subCat !== eb.subCat)
        : !!(ea && ea.cat && eb && eb.cat && ea.cat !== eb.cat);
      if (used.b && used.a && !catChanged && bsrMove(used.a, used.b, used.kind) === 'worse') n++;   // bsrDecide's move
    });
    own[b] = n;
  }
  DASH.bsrOwn = own;
}
const DASH_LOAD = { sales: dashLoadSales, ads: dashLoadAds, vi: () => viDashLoad(), age: dashLoadAge, health: dashLoadHealth, lh: dashLoadLh,
  img: dashLoadIml, lerr: dashLoadIml, bsr: dashLoadBsr };

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
    .then(() => { clearTimeout(timer); delete DASH.memo[key]; if (DASH.st[key].s === 'ok') dashStore(key); dashChanged(key); dashLiveLine();
      if (typeof ncSoon === 'function') ncSoon(key); });   // Numbers Check runs again on what just loaded (sales/sales-check.js)
}
// Every source, in order: Sales · PPC · Inventory first, then Listing Health, then the four that read the listing lists.
function dashPrefetch() {
  if (!dashMay('dash')) return;
  ['sales', 'ads', 'vi', 'age', 'health', 'img', 'lerr', 'bsr', 'lh'].forEach(dashRun);
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
    if (dashShown() && DASH.rendered) { dashPaint([...new Set(DASH_KEYS[key].slots)], 'swap'); dashLiveLine(); }
  });
}

/* ================= WHAT A CARD SHOWS: fresh, else cached (amber), else a shimmer while loading, else why not ================= */
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
    const busy = st.s === 'loading' || st.s === 'idle' || (key === 'health' && DASH.warmP);
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
const dashSk = w => `<span class="dash-sk" style="width:${w}"></span>`;
const dashOpenBtn = tab => (dashMay(tab) ? `<button type="button" class="dash-open" data-dash-open="${tab}">Open →</button>` : '');
const dashFootText = d => (d.state === 'fresh' ? d.v.when : d.state === 'cached' ? 'as of ' + dashWhen(d.v.at) + d.note : d.state === 'loading' ? 'loading…'
  : d.state === 'deny' ? 'not in your access' : "couldn't load");
function dashFoot(d, tab) {
  if (d.state === 'fail') return `<div class="dash-w" title="${dashEsc(d.why || '')}">couldn't load · <button type="button" class="dash-go" data-dash-open="${tab}">open the screen</button></div>`;
  const t = dashFootText(d);
  return `<div class="dash-w${d.state === 'cached' ? ' is-old' : d.state === 'loading' ? ' is-wait' : ''}" title="${dashEsc(t)}">${dashEsc(t)}</div>`;
}
// A number that counts: the exact text is there from the start; the animation only runs towards it. k names it across redraws.
const dashCu = (v, fmt, k, tag) => `<${tag || 'span'} data-cu="${Number(v) || 0}" data-fmt="${fmt}" data-k="${k}">${dashEsc(DASH_FMT[fmt](v))}</${tag || 'span'}>`;
const dashDelta = (now, was) => (was ? `<span class="dash-badge ${now >= was ? 'is-up' : 'is-dn'}">${now < was ? '▼' : '▲'} ${Math.abs((now - was) / was * 100).toFixed(1)}%</span><span>vs LY</span>`
  : '<span>— vs LY</span>');
// A sparkline of a few values (a path the motion draws).
function dashSpark(vals, cls) {
  const v = (vals || []).filter(x => x != null);
  if (v.length < 2) return '';
  const W = 120, H = 34, max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  const p = v.map((x, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1) * W).toFixed(1)} ${(H - 3 - (x - min) / span * (H - 6)).toFixed(1)}`).join(' ');
  return `<svg class="dash-spark ${cls || ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="${p}"/></svg>`;
}

function dashKpi(i, icon, label, tab, d, value, sub, spark) {
  const ok = dashOk(d);
  return `<article class="dash-card dash-kpi dash-glass" style="--i:${i}">
    <span class="dash-ring" aria-hidden="true"><i></i></span><span class="dash-shine" aria-hidden="true"></span>
    <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${label}</span>${dashOpenBtn(tab)}</div>
    <div class="dash-v${ok ? '' : ' is-none'}">${ok ? value() : d.state === 'loading' ? dashSk('62%') : '—'}</div>
    <div class="dash-s">${ok ? sub() : d.state === 'loading' ? dashSk('45%') : ''}</div>
    ${ok && spark ? spark() : ''}
    ${dashFoot(d, tab)}</article>`;
}
// A "needs attention" tile: the whole tile opens its screen; it breathes softly in its colour while its number is above 0.
function dashTile(i, icon, motion, tone, label, tab, d, big, more, hot) {
  const ok = dashOk(d);
  const go = dashMay(tab);
  const foot = d.state === 'fail' ? `<span class="dash-w" title="${dashEsc(d.why || '')}">couldn't load · open the screen</span>`
    : `<span class="dash-w${d.state === 'cached' ? ' is-old' : d.state === 'loading' ? ' is-wait' : ''}">${dashEsc(dashFootText(d))}</span>`;
  return `<button type="button" class="dash-card dash-tile is-${tone}${ok && hot(d.v) ? ' is-hot' : ''}" style="--i:${i}" data-motion="${motion}"${go ? ` data-dash-open="${tab}"` : ' disabled'}>
    <span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${dashEsc(label)}</span>
    <b>${ok ? big(d.v) : d.state === 'loading' ? dashSk('40%') : '—'}</b><span class="dash-more">${ok ? more(d.v) : ''}</span>
    ${foot}${go ? '<span class="dash-open">Open →</span>' : ''}</button>`;
}
const DASH_BUCKETS = [['critical', 'is-c', 'Critical'], ['action', 'is-a', 'Needs Action'], ['review', 'is-r', 'Needs Review'],
  ['healthy', 'is-h', 'Healthy'], ['monitor', 'is-m', 'Monitor'], ['unchecked', 'is-u', 'Not checked']];

// Each card's HTML; i = its place in the stagger.
const DASH_PAINT = {
  // This week in plain English: the headline, one sentence (Claude's when it checked, else the rule-written one) and Open → the Sales Dashboard
  tVi: i => {
    const d = dashData('vi');
    const ok = dashOk(d);
    // the headline with its ▲ / ▼ badge, then the first sentence (an older browser copy without a headline shows the sentence alone)
    const head = ok && d.v.head ? `<b class="dash-vi-h">${dashEsc(d.v.head)}${d.v.pct != null ? ` <span class="dash-vi-b ${d.v.up ? 'is-up' : 'is-dn'}">${d.v.up ? '▲' : '▼'} ${Math.abs(d.v.pct).toFixed(1)}%</span>` : ''}</b>` : '';
    const body = ok ? head + dashEsc(d.v.text) : d.state === 'fresh' && d.v && d.v.why ? `<span class="dash-vi-why">${dashEsc(d.v.why)}</span>` : d.state === 'loading' ? dashSk('80%') : '—';
    return `<article class="dash-card dash-vi dash-glass" style="--i:${i}"><div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">💬</span>This week in plain English</span>${dashOpenBtn('sales')}</div>`
      + `<p class="dash-vi-t">${body}</p>${dashFoot(d, 'sales')}</article>`;
  },
  // What needs attention, in real numbers only (fresh or this browser's copy): up to five lines.
  ticker: () => {
    const lines = [];
    const h = dashData('health'), e = dashData('lerr'), a = dashData('age'), b = dashData('bsr'), p = dashData('img'), s = dashData('sales'), ad = dashData('ads');
    if (dashOk(h) && h.v.critical) lines.push(['is-c', `${DASH_FMT.num(h.v.critical)} listings Critical`]);
    if (dashOk(e) && e.v.n) lines.push(['is-c', `${DASH_FMT.num(e.v.n)} listings with an Amazon error`]);
    if (dashOk(a) && a.v.units) lines.push(['is-a', `${DASH_FMT.num(a.v.units)} units aged 181+`]);
    if (dashOk(b) && b.v.n) lines.push(['is-a', `${DASH_FMT.num(b.v.n)} parents' BSR got worse`]);
    if (dashOk(p) && p.v.n) lines.push(['is-r', `${DASH_FMT.num(p.v.n)} listings need pictures`]);
    if (lines.length < 5 && dashOk(s) && s.v.ml) { const c = (s.v.mc - s.v.ml) / s.v.ml * 100; lines.push([c < 0 ? 'is-c' : 'is-h', `Sales MTD ${c < 0 ? '▼' : '▲'}${Math.abs(c).toFixed(1)}% vs LY`]); }
    if (lines.length < 5 && dashOk(ad) && ad.v.tacos != null) lines.push([ad.v.tacos > 20 ? 'is-a' : 'is-h', `TACoS ${ad.v.tacos}% · ${ad.v.last.label}`]);
    if (!lines.length) return '';
    const run = lines.slice(0, 5).map(([cls, t]) => `<span class="dash-tick"><i class="dash-dot ${cls}"></i>${dashEsc(t)}</span>`).join('');
    return `<div class="dash-ticker" role="status" aria-label="Needs attention"><span class="dash-ticker-h">Needs attention</span>`
      + `<div class="dash-ticker-v"><div class="dash-ticker-in">${run}<span class="dash-ticker-copy" aria-hidden="true">${run}</span></div></div></div>`;
  },
  kSales: i => { const d = dashData('sales'); return dashKpi(i, '💰', 'Sales MTD', 'sales', d, () => dashCu(d.v.mtd, 'money', 'mtd'), () => dashDelta(d.v.mc, d.v.ml) + '<span>· complete days</span>', () => dashSpark(d.v.spark30)); },
  kYtd: i => { const d = dashData('sales'); return dashKpi(i, '📈', 'Sales YTD', 'sales', d, () => dashCu(d.v.ytd, 'money', 'ytd'), () => dashDelta(d.v.yc, d.v.yl) + '<span>· complete days</span>', () => dashSpark(d.v.months)); },
  kAds: i => {
    const d = dashData('ads');
    return dashKpi(i, '📢', 'Ad spend · latest week', 'ppcn', d, () => dashCu(d.v.last.spend, 'money', 'spend'),
      () => `<span>TACoS <b class="${d.v.tacos != null && d.v.tacos > 20 ? 'dash-bad' : ''}">${d.v.tacos == null ? '—' : d.v.tacos + '%'}</b></span>`
        + `<span>${dashEsc(d.v.last.label)}${d.v.last.done ? '' : ' · ' + d.v.days + '/7 days'}</span>${d.v.only ? `<span>${dashEsc(d.v.only)}</span>` : ''}`,
      () => dashSpark(d.v.per.map(p => p.spend), 'is-act'));
  },
  kList: i => {
    const d = dashData('health');
    return dashKpi(i, '🩺', 'Listings', 'health', d, () => dashCu(d.v.n, 'num', 'ln'),
      () => `<span><b class="dash-bad">${DASH_FMT.num(d.v.critical)}</b> critical</span><span>${DASH_FMT.num(d.v.action)} action · ${DASH_FMT.num(d.v.review)} review</span>`, null);
  },
  flow: i => {
    const h = dashData('health'), l = dashData('lh');
    const hv = dashOk(h) ? h.v : null, lv = dashOk(l) ? l.v : null;
    const step = (s, cls, label, src, v, sub, tab, level, vol) => {
      const go = dashMay(tab);
      const val = v != null ? dashCu(v, 'num', 'f' + s) : src.state === 'loading' ? dashSk('50%') : '—';
      return `<button type="button" class="dash-step ${cls}${vol ? ' has-n' : ''}" style="--s:${s}" data-s="${s}" data-vol="${vol || 0}"${go ? ` data-dash-open="${tab}"${level ? ` data-dash-level="${level}"` : ''}` : ' disabled'}`
        + ` title="${dashEsc(label)}${go ? ' — open' : ''}"><span class="dash-step-l">${dashEsc(label)}</span><b>${val}</b><small>${sub}</small></button>`;
    };
    // a pipe: the glowing tube, its arrowhead, and the dots that run through it
    const pipe = s => `<span class="dash-arrow dash-pipe" style="--s:${s}" data-s="${s}" aria-hidden="true"><svg viewBox="0 0 44 14">`
      + `<path class="dash-pipe-bg" d="M2 7H40"/><path class="dash-pipe-p" pathLength="1" d="M2 7H40"/><path class="dash-pipe-h" pathLength="1" d="M35 2.5 40.5 7 35 11.5"/>`
      + '<circle class="dash-flowdot" r="2.2" cx="0" cy="0"/><circle class="dash-flowdot" r="2.2" cx="0" cy="0"/><circle class="dash-flowdot" r="2.2" cx="0" cy="0"/></svg></span>';
    const lhTab = dashMay('lhist') ? 'lhist' : 'health';
    const zero = (now, prev, what) => (now === 0 && prev != null ? `0 this month · last month ${DASH_FMT.num(prev)}` : what);
    const problems = hv ? hv.critical + hv.action + hv.review : null;
    const line = [...new Set([dashFootText(h), dashFootText(l)])].filter(Boolean).join(' · ');
    return `<article class="dash-card dash-flowcard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🔁</span>Listing flow</span>${dashOpenBtn('health')}</div>
      <div class="dash-flowrow">
        <div class="dash-track" aria-hidden="true"><span class="dash-runner"><i></i></span></div>
        ${step(0, '', 'All listings', h, hv ? hv.n : null, 'in Listing Health', 'health', 'ALL', hv && hv.n)}${pipe(0)}
        ${step(1, 'is-act', 'Problems found', h, problems, 'critical + action + review', 'health', 'ALL', problems)}${pipe(1)}
        ${step(2, 'is-bad', 'Critical', h, hv ? hv.critical : null, 'fix first', 'health', 'critical', hv && hv.critical)}${pipe(2)}
        ${step(3, 'is-brand', 'Fixed / Approved', l, lv ? lv.fixed : null, dashEsc(lv ? zero(lv.fixed, lv.fixedPrev, 'sent this month') : 'sent this month'), lhTab, '', lv && lv.fixed)}${pipe(3)}
        ${step(4, 'is-ok', 'On Amazon', l, lv ? lv.amz : null, dashEsc(lv ? zero(lv.amz, lv.amzPrev, 'accepted this month') : 'accepted this month'), lhTab, '', lv && lv.amz)}
      </div>
      <div class="dash-w${h.state === 'cached' || l.state === 'cached' ? ' is-old' : ''}" title="${dashEsc(line)}">${dashEsc(line)}${
        h.state === 'fail' ? ' · <button type="button" class="dash-go" data-dash-open="health">open the screen</button>' : ''}</div></article>`;
  },
  donut: i => {
    const d = dashData('health');
    const ok = dashOk(d) && d.v.per;
    const one = b => {
      const x = d.v.per[b];
      const parts = DASH_BUCKETS.map(([k, cls, label]) => [k, cls, label, x[k] || 0]);
      const total = parts.reduce((s, p) => s + p[3], 0) || 1;
      let at = 0;
      const segs = parts.filter(p => p[3] > 0).map(([k, cls, label, n]) => {
        const len = n / total * 100;
        const mid = (at + len / 2) / 100 * Math.PI * 2;
        const seg = `<circle class="dash-seg ${cls}" data-b="${k}" data-n="${n}" data-pct="${(n / total * 100).toFixed(1)}" data-label="${dashEsc(label)}" data-brand="${dashEsc(dashName(b))}"`
          + ` data-dx="${(Math.cos(mid) * 6).toFixed(2)}" data-dy="${(Math.sin(mid) * 6).toFixed(2)}" data-len="${Math.max(0, len - (len > 1.2 ? 0.6 : 0)).toFixed(2)}"`
          + ` cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="${Math.max(0, len - (len > 1.2 ? 0.6 : 0)).toFixed(2)} 100" stroke-dashoffset="${(-at).toFixed(2)}"></circle>`;
        at += len;
        return seg;
      }).join('');
      return `<figure class="dash-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${dashEsc(dashName(b))}: ${x.critical} critical, ${x.action} needs action, ${x.review} needs review, ${x.healthy} healthy, ${x.monitor} monitor">`
        + `<defs><mask id="dashMask${b}"><circle class="dash-dm" cx="60" cy="60" r="44" pathLength="1" stroke="white" transform="rotate(-90 60 60)"/></mask></defs>`
        + `<g mask="url(#dashMask${b})"><g transform="rotate(-90 60 60)">${segs}</g></g>`
        + `<text class="dash-mid" x="60" y="62" text-anchor="middle">${dashCu(x.n, 'num', 'dn' + b, 'tspan')}</text><text class="dash-midl" x="60" y="77" text-anchor="middle">listings</text></svg>`
        + `<figcaption>${dashEsc(dashName(b))}</figcaption><div class="dash-mini">`
        + DASH_BUCKETS.slice(0, 5).map(([k, cls]) => `<span data-b="${k}"><i class="dash-dot ${cls}"></i>${DASH_FMT.num(x[k] || 0)}</span>`).join('')
        + '</div></figure>';
    };
    const bs = ok ? Object.keys(d.v.per) : [];
    const anyU = ok && bs.some(b => d.v.per[b].unchecked);
    return `<article class="dash-card dash-donutcard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🍩</span>Listing Health</span>${dashOpenBtn('health')}</div>
      ${ok ? `<div class="dash-donuts">${bs.map(one).join('')}</div>
      <div class="dash-key">${DASH_BUCKETS.filter(([k]) => k !== 'unchecked' || anyU).map(([k, cls, label]) => `<span class="dash-chip" data-b="${k}"><i class="dash-dot ${cls}"></i>${label}</span>`).join('')}</div>`
        : d.state === 'loading' ? '<div class="dash-donuts"><span class="dash-sk is-round"></span><span class="dash-sk is-round"></span></div>' : '<div class="dash-v is-none">—</div>'}
      <div class="dash-tip" aria-hidden="true"></div>
      ${dashFoot(d, 'health')}</article>`;
  },
  line: i => {
    const d = dashData('sales');
    const ok = dashOk(d) && d.v.pts && d.v.pts.length > 1;
    let svg = '';
    if (ok) {
      const pts = d.v.pts;
      const W = 300, H = 130, L = 4, R = 6, T = 18, B = 18;
      const max = Math.max(1, ...pts.map(p => p.v));
      const x = k => L + k / (pts.length - 1) * (W - L - R);
      const y = v => T + (H - T - B) - v / max * (H - T - B);
      const line = pts.map((p, k) => (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
      const area = `M${x(0).toFixed(1)} ${H - B} ` + pts.map((p, k) => 'L' + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') + ` L${x(pts.length - 1).toFixed(1)} ${H - B} Z`;
      const short = iso => String(Number(iso.slice(8, 10))) + ' ' + DASH_MON[Number(iso.slice(5, 7)) - 1];
      const top = pts.reduce((m, p, k) => (p.v > pts[m].v ? k : m), 0);
      const lx = x(pts.length - 1), ly = y(pts[pts.length - 1].v);
      svg = `<svg class="dash-chart dash-linechart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales, last 90 days" data-n="${pts.length}" data-l="${L}" data-r="${R}" data-w="${W}">`
        + '<defs><linearGradient id="dashAreaG" x1="0" y1="0" x2="0" y2="1"><stop class="dash-st1" offset="0"/><stop class="dash-st2" offset="1"/></linearGradient></defs>'
        + `<line class="dash-base" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`
        + `<path class="dash-area" d="${area}" fill="url(#dashAreaG)"/><path class="dash-line" pathLength="1" d="${line}"/>`
        + `<g class="dash-top" transform="translate(${x(top).toFixed(1)} ${y(pts[top].v).toFixed(1)})"><path class="dash-star" d="M0-6 1.8-1.9 6.2-1.9 2.7 0.8 4 5.2 0 2.6-4 5.2-2.7 0.8-6.2-1.9-1.8-1.9Z"/>`
        + `<text class="dash-axis dash-toplabel" x="${x(top) > W - 70 ? -8 : 8}" y="-6" text-anchor="${x(top) > W - 70 ? 'end' : 'start'}">top day ${DASH_FMT.money(pts[top].v)}</text></g>`
        + `<g class="dash-cross" style="opacity:0"><line class="dash-cross-l" x1="0" y1="${T - 6}" x2="0" y2="${H - B}"/><circle class="dash-cross-c" r="3.5" cx="0" cy="0"/></g>`
        + `<circle class="dash-ride" r="4" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}"/><circle class="dash-ride-p" r="4" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}"/>`
        + `<text class="dash-axis" x="${L}" y="${H - 4}">${short(pts[0].d)}</text><text class="dash-axis" x="${W - R}" y="${H - 4}" text-anchor="end">${short(pts[pts.length - 1].d)}</text></svg>`;
    }
    return `<article class="dash-card dash-linecard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📊</span>Sales · last 90 days</span>${dashOpenBtn('sales')}</div>
      ${ok ? `<div class="dash-s"><b>${dashCu(d.v.pts.reduce((t, p) => t + p.v, 0), 'money', 's90')}</b><span>in 90 days</span></div>${svg}`
        : d.state === 'loading' ? `<div class="dash-s">${dashSk('40%')}</div><span class="dash-sk is-chart"></span>` : '<div class="dash-v is-none">—</div>'}
      <div class="dash-tip" aria-hidden="true"></div>
      ${dashFoot(d, 'sales')}</article>`;
  },
  bars: i => {
    const d = dashData('ads');
    const ok = dashOk(d) && d.v.per && d.v.per.length;
    let svg = '';
    if (ok) {
      const W = 300, H = 130, T = 6, B = 18;
      const n = d.v.per.length, gw = W / n, bw = Math.min(14, gw * 0.32);
      const max = Math.max(1, ...d.v.per.map(p => Math.max(p.rev, p.spend)));
      const h = v => v / max * (H - T - B);
      svg = `<svg class="dash-chart dash-barchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and ad spend, last ${n} weeks">`
        + '<defs><pattern id="dashStripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><g class="dash-stripes">'
        + '<rect class="dash-stripe-a" width="6" height="6"/><rect class="dash-stripe-b" width="3" height="6"/><rect class="dash-stripe-b" x="6" width="3" height="6"/><rect class="dash-stripe-b" x="-6" width="3" height="6"/></g></pattern></defs>'
        + `<line class="dash-base" x1="0" y1="${H - B}" x2="${W}" y2="${H - B}"/>`
        + d.v.per.map((p, k) => {
          const cx = gw * k + gw / 2, run = p.done ? '' : ' is-run';
          const data = ` data-w="${dashEsc(p.label)}${p.done ? '' : ' (still running)'}" data-rev="${p.rev}" data-spend="${p.spend}"`;
          return `<g class="dash-week"${data}>`
            + `<rect class="dash-hit" x="${(gw * k).toFixed(1)}" y="0" width="${gw.toFixed(1)}" height="${H - B}"/>`
            + `<rect class="dash-bar is-sales${run}" style="--b:${k * 2}" x="${(cx - bw - 1).toFixed(1)}" y="${(H - B - h(p.rev)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.rev).toFixed(1)}" rx="2"${p.done ? '' : ' fill="url(#dashStripe)"'}/>`
            + `<rect class="dash-bar is-spend${run}" style="--b:${k * 2 + 1}" x="${(cx + 1).toFixed(1)}" y="${(H - B - h(p.spend)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.spend).toFixed(1)}" rx="2"/>`
            + `<text class="dash-axis" x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${dashEsc(p.label.split('-')[0])}</text></g>`;
        }).join('') + '</svg>';
    }
    return `<article class="dash-card dash-barcard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📦</span>PPC · weekly</span>${dashOpenBtn('ppcn')}</div>
      ${ok ? `<div class="dash-key" style="justify-content:flex-start"><span><i class="dash-dot is-sales"></i>Sales</span><span><i class="dash-dot is-spend"></i>Ad spend</span><span><i class="dash-dot is-run"></i>running week</span>${d.v.only ? `<span>${dashEsc(d.v.only)}</span>` : ''}</div>${svg}`
        : d.state === 'loading' ? `<div class="dash-s">${dashSk('35%')}</div><span class="dash-sk is-chart"></span>` : '<div class="dash-v is-none">—</div>'}
      <div class="dash-tip" aria-hidden="true"></div>
      ${dashFoot(d, 'ppcn')}</article>`;
  },
  tImg: i => dashTile(i, '🖼', 'wiggle', 'violet', 'Need pictures', 'img', dashData('img'), v => dashCu(v.n, 'num', 'img'), v => 'listings that need pictures · Image Manager' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.n > 0),
  tErr: i => dashTile(i, '⚠️', 'bounce', 'red', 'Listing errors', 'lerr', dashData('lerr'), v => dashCu(v.n, 'num', 'err'), v => 'listings with an Amazon error' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.n > 0),
  tBsr: i => dashTile(i, '📉', 'dip', 'orange', 'BSR got worse', 'bsr', dashData('bsr'), v => dashCu(v.n, 'num', 'bsr'), v => 'parents' + (v.high != null ? ` · ${DASH_FMT.num(v.high)} high priority` : ''), v => v.n > 0),
  tAge: i => dashTile(i, '⏳', 'spin', 'teal', 'Aged 181+ units', 'age', dashData('age'), v => dashCu(v.units, 'num', 'aged'),
    v => (v.storage ? dashCu(v.storage, 'usd2', 'stor') : '—') + ' storage' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.units > 0),
};

/* ================= DRAWING ================= */
// Draw these cards. mode 'intro' = the page arriving; 'brand' = another brand picked (numbers count over, charts draw again);
// 'swap' = new numbers for cards already on screen (they count over; a shimmer morphs into its number; nothing else moves).
function dashPaint(ids, mode) {
  const eng = DASH.eng || 'none';                 // the motion chosen when the page was drawn (dashRender)
  ids.forEach(id => {
    const el = $('dash-' + id);
    if (!el) return;
    dashKill(id);
    let html;
    try { html = DASH_PAINT[id](DASH_SLOTS.indexOf(id)); } catch (e) { html = '<article class="dash-card"><div class="dash-v is-none">—</div></article>'; }
    const was = DASH.was[id];
    DASH.was[id] = /dash-sk/.test(html) ? 'sk' : /data-cu=/.test(html) ? 'ok' : 'none';
    el.classList.toggle('is-swap', mode === 'swap');
    el.classList.toggle('is-empty', !html);
    el.innerHTML = html;
    try { dashAnim(id, el, mode === 'intro' ? DASH_SLOTS.indexOf(id) : 0, mode, eng, was); } catch (e) { /* shown as it is */ }
    try { dashHover(id, el, eng); } catch (e) { /* the numbers are there anyway */ }
  });
  dashStRefresh();
  dashParty();
}
// The whole page: background, greeting, clock, brand switch, the ticker, then every card.
function dashRender() {
  const root = $('dashRoot');
  if (!root) return;
  dashKillAll();
  dashStop();
  dashDotsStop();
  DASH.memo = {};
  DASH.shown = {};
  DASH.was = {};
  const eng = DASH.eng = dashEngine();
  $('paneDash').classList.toggle('dash-fx', eng === 'css');
  $('paneDash').classList.toggle('dash-gs', eng === 'gsap');
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = dashWho();
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const brand = (v, t) => `<button type="button" data-dash-brand="${v}" aria-pressed="${DASH.brand === v}">${t}</button>`;
  const slot = id => `<div class="dash-slot" id="dash-${id}"></div>`;
  root.innerHTML = '<div class="dash-glow dash-aurora" aria-hidden="true"><i></i><i></i><i></i><i></i></div><canvas class="dash-dots" aria-hidden="true"></canvas>'
    + `<header class="dash-hero"><div><h3 class="dash-hi"><span class="dash-hi-t">${hi}${who ? ', ' : ''}</span>${who ? `<span class="dash-name">${dashEsc(who)}</span>` : ''}</h3>`
    + `<div class="dash-date"><span class="dash-clock">${dashClockText()}</span><span>${dashEsc(date)}</span><span class="dash-live"><i></i><b>Live</b> <span class="dash-live-t"></span></span></div><button type="button" class="nc-chip" id="ncChipDash" hidden></button></div>`
    + `<div class="dash-brands" role="group" aria-label="Brand"><span class="dash-pill" aria-hidden="true"></span>${brand('ALL', 'Both')}${brand('SP', 'Ridhi')}${brand('CPC', 'CPC')}</div></header>`
    + slot('ticker')
    + `<section class="dash-grid dash-vi-row">${slot('tVi')}</section>`
    + `<section class="dash-grid dash-kpis">${['kSales', 'kYtd', 'kAds', 'kList'].map(slot).join('')}</section>`
    + `<section class="dash-grid">${slot('flow')}</section>`
    + `<section class="dash-grid dash-row3">${['donut', 'line', 'bars'].map(slot).join('')}</section>`
    + `<section class="dash-grid dash-tiles">${['tImg', 'tErr', 'tBsr', 'tAge'].map(slot).join('')}</section>`;
  DASH.rendered = true;
  dashLiveLine();
  dashPill(false);
  if (eng === 'gsap') dashGsRoot(root);
  dashPaint(DASH_SLOTS, 'intro');
  dashDotsStart(root);
  dashLoops();
  if (typeof ncChipPaint === 'function') ncChipPaint();   // the Numbers Check chip under the greeting (sales/sales-check.js)
}
// The brand switch's sliding pill: under the brand on view (moved with GSAP, or by a CSS transition without it).
function dashPill(move) {
  const box = document.querySelector('#paneDash .dash-brands');
  const pill = box && box.querySelector('.dash-pill');
  const on = box && box.querySelector('[aria-pressed="true"]');
  if (!pill || !on) return;
  const x = on.offsetLeft, w = on.offsetWidth;
  if (move && DASH.eng === 'gsap') window.gsap.to(pill, { x, width: w, duration: 0.45, ease: 'power3.out' });
  else { pill.style.width = w + 'px'; pill.style.transform = `translateX(${x}px)`; }
  pill.classList.add('is-on');
}
// The clock and the "● Live" line (the time of the newest number that arrived).
const dashClockText = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function dashLiveLine() {
  const el = document.querySelector('#paneDash .dash-live-t');
  if (el) el.textContent = DASH.lastFresh ? '· updated ' + dashHm(DASH.lastFresh) : '· loading…';
}

/* ================= MOTION — GSAP (+ ScrollTrigger, MotionPathPlugin), else CSS; nothing when ✨ is off ================= */
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
// GSAP and its two plugins, fetched once, the first time the Dashboard opens with ✨ on. true = GSAP ready (the plugins are extras).
function dashGsap() {
  if (window.gsap && DASH.gs === true) return Promise.resolve(true);
  if (!DASH.gsTry) DASH.gsTry = (async () => {
    const ok = window.gsap || await dashScript(DASH_CDN + 'gsap.min.js');
    if (!ok || !window.gsap) { DASH.gs = false; return false; }
    const [st, mp] = await Promise.all([window.ScrollTrigger || dashScript(DASH_CDN + 'ScrollTrigger.min.js'), window.MotionPathPlugin || dashScript(DASH_CDN + 'MotionPathPlugin.min.js')]);
    try {
      window.gsap.config({ nullTargetWarn: false });
      window.gsap.ticker.fps(60);
      DASH.plug.st = !!(st && window.ScrollTrigger);
      DASH.plug.mp = !!(mp && window.MotionPathPlugin);
      window.gsap.registerPlugin(...[DASH.plug.st && window.ScrollTrigger, DASH.plug.mp && window.MotionPathPlugin].filter(Boolean));
      DASH.gs = true;
    } catch (e) { DASH.gs = false; }
    return DASH.gs;
  })();
  return DASH.gsTry;
}
const dashTw = (id, t) => { if (t) (DASH.tw[id] || (DASH.tw[id] = [])).push(t); return t; };
function dashKill(id) {
  (DASH.tw[id] || []).forEach(t => {
    try { if (t.scrollTrigger) t.scrollTrigger.kill(); } catch (e) { /* gone */ }
    try { t.kill(); } catch (e) { /* gone */ }
  });
  DASH.tw[id] = [];
}
// ScrollTrigger measures where each tile is when it is made; a drawing that changes the page's height (or a scroll it has not seen
// yet) would leave a tile waiting for a scroll that never comes — so it measures again just after every drawing.
function dashStRefresh() {
  if (!(DASH.plug.st && window.ScrollTrigger) || DASH.eng !== 'gsap') return;
  clearTimeout(DASH.stT);
  DASH.stT = setTimeout(() => { try { window.ScrollTrigger.refresh(); } catch (e) { /* the tiles show anyway when scrolled */ } }, 120);
}
const dashKillAll = () => Object.keys(DASH.tw).forEach(dashKill);
// The page: the greeting typed in, the aurora drifting.
function dashGsRoot(root) {
  const g = window.gsap;
  const hero = root.querySelector('.dash-hero');
  dashTw('root', g.from(hero, { opacity: 0, y: 16, duration: 0.6, ease: 'power3.out', clearProps: 'opacity,transform' }));
  const typed = hero.querySelectorAll('.dash-hi-t, .dash-name');
  typed.forEach(el => { el.dataset.full = el.textContent; });
  const total = [...typed].reduce((s, el) => s + el.dataset.full.length, 0);
  const o = { n: 0 };
  typed.forEach(el => { el.textContent = ''; });
  dashTw('root', g.to(o, { n: total, duration: Math.min(1.4, 0.045 * total), ease: 'none', delay: 0.15,
    onUpdate: () => { let left = Math.round(o.n); typed.forEach(el => { const t = el.dataset.full; el.textContent = t.slice(0, Math.max(0, left)); left -= t.length; }); },
    onComplete: () => { typed.forEach(el => { el.textContent = el.dataset.full; }); hero.classList.add('is-typed'); } }));
  dashGsAurora(root);
}
function dashGsAurora(root) {
  root.querySelectorAll('.dash-aurora i').forEach((blob, k) => {
    dashTw('root', window.gsap.to(blob, { xPercent: [14, -12, 10, -16][k], yPercent: [10, 16, -12, -8][k], scale: 1.18, duration: 16 + k * 5, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  });
}
// GSAP arrived after the page was drawn with the CSS motion (a slow first download): once the CSS entrance is over, the page moves to
// GSAP quietly — the cards are drawn again with the same numbers (nothing counts or comes in again) and the GSAP loops start.
function dashGsUpgrade() {
  setTimeout(() => {
    if (DASH.eng !== 'css' || !dashFxOn() || !(window.gsap && DASH.gs === true) || !dashShown()) return;
    DASH.eng = 'gsap';
    $('paneDash').classList.remove('dash-fx');
    $('paneDash').classList.add('dash-gs');
    const root = $('dashRoot');
    root.querySelector('.dash-hero').classList.add('is-typed');
    dashGsAurora(root);
    dashPaint(DASH_SLOTS, 'swap');
    dashLoops();
  }, 2800);
}
// One card: its numbers; with GSAP its entrance, charts, pipes and loops.
function dashAnim(id, el, i, mode, eng, was) {
  dashNumbers(id, el, i, mode, eng, was);
  if (eng !== 'gsap') return;
  const g = window.gsap;
  const d = i * 0.07 + 0.08;
  const card = el.querySelector('.dash-card, .dash-ticker');
  const reveal = mode === 'swap' && was === 'sk';                     // a shimmer that becomes its number
  const draw = mode !== 'swap' || was !== 'ok';                         // the charts draw when they first appear (and on a brand change)
  if (mode === 'intro' && card) {
    if (/^t[A-Z]/.test(id) && DASH.plug.st) {
      dashTw(id, g.from(card, { opacity: 0, y: 30, scale: 0.94, duration: 0.8, ease: 'back.out(1.6)', clearProps: 'opacity,transform',
        scrollTrigger: { trigger: card, start: 'top 96%', once: true } }));
    } else dashTw(id, g.from(card, { opacity: 0, y: 26, scale: 0.9, duration: 1.1, ease: 'elastic.out(1, 0.75)', delay: d, clearProps: 'opacity,transform' }));
  }
  if (reveal) dashTw(id, g.from(el.querySelectorAll('.dash-v, .dash-s, .dash-step b, .dash-tile b, .dash-donuts, .dash-chart, .dash-spark'),
    { opacity: 0, scale: 0.94, filter: 'blur(6px)', duration: 0.6, ease: 'power2.out', stagger: 0.04, clearProps: 'filter,transform,opacity' }));
  const dd = mode === 'intro' ? d + 0.25 : 0.05;
  if (draw) {
    el.querySelectorAll('.dash-badge').forEach(b => dashTw(id, g.from(b, { scale: 0, opacity: 0, duration: 0.6, ease: 'back.out(3)', delay: dd + 0.5, clearProps: 'transform,opacity' })));
    el.querySelectorAll('.dash-spark path').forEach(p => dashTw(id, g.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', delay: dd + 0.2 })));
    const steps = el.querySelectorAll('.dash-step');
    if (steps.length) dashTw(id, g.from(steps, { opacity: 0, y: 14, scale: 0.94, duration: 0.55, ease: 'back.out(1.7)', delay: dd, stagger: 0.16, clearProps: 'opacity,transform' }));
    el.querySelectorAll('.dash-pipe').forEach((a, k) => {
      dashTw(id, g.fromTo(a.querySelectorAll('.dash-pipe-p, .dash-pipe-h'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, ease: 'power1.out', delay: dd + 0.2 + k * 0.16 }));
    });
    el.querySelectorAll('.dash-seg').forEach((s, k) => {
      const len = s.dataset.len;
      dashTw(id, g.fromTo(s, { attr: { 'stroke-dasharray': '0 100' } }, { attr: { 'stroke-dasharray': `${len} 100` }, duration: 0.5, ease: 'power2.out', delay: dd + k % 6 * 0.18 }));
    });
    el.querySelectorAll('.dash-line').forEach(p => dashTw(id, g.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.4, ease: 'power1.inOut', delay: dd })));
    el.querySelectorAll('.dash-area').forEach(p => dashTw(id, g.from(p, { opacity: 0, duration: 0.9, delay: dd + 1.1 })));
    el.querySelectorAll('.dash-top').forEach(t => dashTw(id, g.from(t, { scale: 0, opacity: 0, transformOrigin: '0px 0px', duration: 0.6, ease: 'back.out(3)', delay: dd + 1.3 })));
    const line = el.querySelector('.dash-line'), ride = el.querySelector('.dash-ride');
    if (line && ride && DASH.plug.mp) {
      const cx = ride.getAttribute('cx'), cy = ride.getAttribute('cy');
      ride.setAttribute('cx', 0); ride.setAttribute('cy', 0);
      dashTw(id, g.fromTo(ride, { opacity: 0 }, { opacity: 1, duration: 0.2, delay: dd }));
      dashTw(id, g.to(ride, { duration: 1.4, ease: 'power1.inOut', delay: dd, motionPath: { path: line, align: line, alignOrigin: [0.5, 0.5] },
        onComplete: () => { g.set(ride, { clearProps: 'transform' }); ride.setAttribute('cx', cx); ride.setAttribute('cy', cy); } }));
    }
    const sales = el.querySelectorAll('.dash-bar.is-sales'), spend = el.querySelectorAll('.dash-bar.is-spend');
    if (sales.length) dashTw(id, g.from(sales, { scaleY: 0, transformOrigin: '50% 100%', duration: 1, ease: 'elastic.out(1, 0.55)', delay: dd, stagger: 0.07 }));
    if (spend.length) dashTw(id, g.from(spend, { scaleY: 0, transformOrigin: '50% 100%', duration: 1, ease: 'elastic.out(1, 0.55)', delay: dd + 0.35, stagger: 0.07 }));
    const icon = el.querySelector('.dash-tile .dash-ic');
    const motion = card && card.dataset ? card.dataset.motion : '';
    if (icon && motion) {
      const st = DASH.plug.st && mode === 'intro' ? { trigger: card, start: 'top 96%', once: true } : undefined;
      g.set(icon, { transformOrigin: '50% 50%' });
      const tl = g.timeline({ delay: dd + 0.5, scrollTrigger: st });
      if (motion === 'wiggle') [-14, 12, -8, 5, 0].forEach(r => tl.to(icon, { rotation: r, duration: 0.15, ease: 'sine.inOut' }));
      else if (motion === 'bounce') [-8, 0, -3, 0].forEach((y, k) => tl.to(icon, { y, duration: 0.18, ease: k % 2 ? 'bounce.out' : 'power2.out' }));
      else if (motion === 'dip') tl.to(icon, { y: 5, rotation: -8, duration: 0.3, ease: 'power2.in' }).to(icon, { y: 0, rotation: 0, duration: 0.45, ease: 'back.out(3)' });
      else if (motion === 'spin') tl.to(icon, { rotation: 180, duration: 0.9, ease: 'power2.inOut' });
      dashTw(id, tl);
    }
  }
  // --- the loops (stopped with the page: hidden tab, another screen) ---
  el.querySelectorAll('.dash-pipe').forEach(a => {
    const path = a.querySelector('.dash-pipe-p');
    const step = el.querySelector(`.dash-step[data-s="${a.dataset.s}"]`);
    const vol = Number(step && step.dataset.vol) || 0;
    const dur = Math.max(0.7, Math.min(2.6, 2.6 - Math.log10(vol + 1) * 0.55));        // more listings, faster flow
    a.querySelectorAll('.dash-flowdot').forEach((dot, k) => {
      if (!vol) { g.set(dot, { opacity: 0 }); return; }
      if (!DASH.plug.mp) g.set(dot, { attr: { cx: 2, cy: 7 } });
      const tl = g.timeline({ repeat: -1, delay: (mode === 'intro' ? dd + 1 : 0.2) + k * dur / 3 });
      tl.fromTo(dot, DASH.plug.mp ? {} : { x: 0 }, Object.assign({ duration: dur, ease: 'none' },
        DASH.plug.mp ? { motionPath: { path, align: path, alignOrigin: [0.5, 0.5] } } : { x: 36 }), 0)
        .fromTo(dot, { opacity: 0 }, { opacity: 1, duration: dur * 0.15, ease: 'none' }, 0)
        .to(dot, { opacity: 0, duration: dur * 0.15, ease: 'none' }, dur * 0.85);
      dashTw(id, tl);
    });
  });
  const crit = el.querySelector('.dash-step.is-bad');
  if (crit && Number(crit.dataset.vol) > 0) dashTw(id, g.to(crit, { '--glow': 1, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  // (the soft pulse at today's point is CSS in both engines: transform-box keeps it on its centre)
  el.querySelectorAll('.dash-stripes').forEach(s => dashTw(id, g.fromTo(s, { x: 0 }, { x: 6, duration: 0.8, ease: 'none', repeat: -1 })));
}
// The numbers: from 0 on arrival (or from what was on screen for a brand change / new data), always ending on the exact text.
function dashNumbers(id, el, i, mode, eng, was) {
  el.querySelectorAll('[data-cu]').forEach(n => {
    const v = Number(n.dataset.cu), fmt = DASH_FMT[n.dataset.fmt], k = n.dataset.k;
    const prev = k in DASH.shown ? DASH.shown[k] : null;
    DASH.shown[k] = v;
    if (!fmt || eng === 'none') return;
    const from = mode === 'intro' ? 0 : prev == null ? 0 : prev;
    if (from === v) return;
    const end = n.textContent;
    const delay = mode === 'intro' ? i * 70 + 200 : 0;
    if (eng === 'gsap') {
      const g = window.gsap, o = { x: from };
      n.textContent = fmt(from);
      dashTw(id, g.to(o, { x: v, duration: mode === 'intro' ? 1.1 : 0.8, ease: 'power3.out', delay: delay / 1000,
        onUpdate: () => { n.textContent = fmt(o.x); }, onComplete: () => { n.textContent = end; } }));
      if (mode === 'swap' && prev != null) dashTw(id, g.fromTo(n, { opacity: 0.3 }, { opacity: 1, duration: 0.6, ease: 'power1.out' }));
      return;
    }
    n.textContent = fmt(from);
    DASH.cu.push({ el: n, from, v, fmt, end, t0: performance.now() + delay });
  });
  if (DASH.cu.length && !DASH.raf) DASH.raf = requestAnimationFrame(dashTick);
  if (DASH.cu.length) { clearTimeout(DASH.safety); DASH.safety = setTimeout(dashStop, 3000); }   // a frame that never comes: the exact text anyway
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

/* ================= HOVER: tooltips (always), lift / tilt / shine / pop (with motion) ================= */
function dashTip(card, html, x, y) {
  const tip = card.querySelector('.dash-tip');
  if (!tip) return;
  if (!html) { tip.classList.remove('is-on'); return; }
  tip.innerHTML = html;
  tip.classList.add('is-on');
  const w = tip.offsetWidth, cw = card.clientWidth;
  tip.style.transform = `translate(${Math.max(6, Math.min(cw - w - 6, x - w / 2))}px, ${Math.max(4, y - tip.offsetHeight - 12)}px)`;
}
function dashHover(id, el, eng) {
  const g = eng === 'gsap' ? window.gsap : null;
  const card = el.querySelector('.dash-card');
  if (!card) return;
  const rel = e => { const r = card.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r]; };
  // KPI cards: 3D tilt (max 6°) and a shine that follows the pointer — GSAP, wide screens, a mouse
  if (g && card.classList.contains('dash-kpi') && !dashPhone()) {
    const rx = g.quickTo(card, 'rotationX', { duration: 0.4, ease: 'power3.out' }), ry = g.quickTo(card, 'rotationY', { duration: 0.4, ease: 'power3.out' });
    const shine = card.querySelector('.dash-shine');
    const sx = shine ? g.quickTo(shine, 'x', { duration: 0.3, ease: 'power2.out' }) : null;
    g.set(card, { transformPerspective: 800 });
    card.addEventListener('mousemove', e => {
      const [x, y, r] = rel(e);
      ry((x / r.width - 0.5) * 12);
      rx(-(y / r.height - 0.5) * 12);
      if (sx) sx(x - r.width);
    });
    card.addEventListener('mouseenter', () => { g.to(card, { y: -4, duration: 0.25, ease: 'power2.out', overwrite: 'auto' }); if (shine) g.to(shine, { opacity: 1, duration: 0.25 }); });
    card.addEventListener('mouseleave', () => { rx(0); ry(0); g.to(card, { y: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }); if (shine) g.to(shine, { opacity: 0, duration: 0.3 }); });
  } else if (g) {
    card.addEventListener('mouseenter', () => g.to(card, { y: -4, duration: 0.22, ease: 'power2.out', overwrite: 'auto' }));
    card.addEventListener('mouseleave', () => g.to(card, { y: 0, duration: 0.28, ease: 'power2.out', overwrite: 'auto' }));
  }
  // flow: a box lifts, the pipe before it brightens
  el.querySelectorAll('.dash-step').forEach(step => {
    const pipe = el.querySelector(`.dash-pipe[data-s="${Number(step.dataset.s) - 1}"]`);
    step.addEventListener('mouseenter', () => { if (pipe) pipe.classList.add('is-hot'); if (g) g.to(step, { y: -5, scale: 1.03, duration: 0.25, ease: 'power2.out', overwrite: 'auto' }); });
    step.addEventListener('mouseleave', () => { if (pipe) pipe.classList.remove('is-hot'); if (g) g.to(step, { y: 0, scale: 1, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }); });
  });
  // donut: a segment pops out 6px, its count and share, its legend chip lights
  el.querySelectorAll('.dash-seg').forEach(seg => {
    const chips = card.querySelectorAll(`.dash-chip[data-b="${seg.dataset.b}"], .dash-mini [data-b="${seg.dataset.b}"]`);
    seg.addEventListener('mouseenter', () => {
      if (eng !== 'none') { if (g) g.to(seg, { x: Number(seg.dataset.dx), y: Number(seg.dataset.dy), duration: 0.25, ease: 'back.out(2)' }); else seg.style.transform = `translate(${seg.dataset.dx}px,${seg.dataset.dy}px)`; }
      chips.forEach(c => c.classList.add('is-on'));
    });
    seg.addEventListener('mousemove', e => { const [x, y] = rel(e); dashTip(card, `<b>${dashEsc(seg.dataset.brand)} · ${dashEsc(seg.dataset.label)}</b>${DASH_FMT.num(Number(seg.dataset.n))} listings · ${seg.dataset.pct}%`, x, y); });
    seg.addEventListener('mouseleave', () => {
      if (g) g.to(seg, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' }); else seg.style.transform = '';
      chips.forEach(c => c.classList.remove('is-on'));
      dashTip(card, '');
    });
  });
  // the 90-day line: crosshair + date and sales
  const lc = el.querySelector('.dash-linechart');
  if (lc) {
    const d = dashData('sales');
    const pts = dashOk(d) ? d.v.pts : [];
    const n = Number(lc.dataset.n), L = Number(lc.dataset.l), R = Number(lc.dataset.r), W = Number(lc.dataset.w);
    const cross = lc.querySelector('.dash-cross'), dot = lc.querySelector('.dash-cross-c');
    const line = lc.querySelector('.dash-line');
    lc.addEventListener('mousemove', e => {
      const r = lc.getBoundingClientRect();
      const vx = (e.clientX - r.left) / r.width * W;
      const k = Math.max(0, Math.min(n - 1, Math.round((vx - L) / (W - L - R) * (n - 1))));
      const p = pts[k];
      if (!p || !line) return;
      const px = L + k / (n - 1) * (W - L - R);
      const seg = line.getAttribute('d').split(/[ML]/).filter(Boolean)[k];
      const py = seg ? Number(seg.trim().split(' ')[1]) : 0;
      cross.style.opacity = 1;
      cross.setAttribute('transform', `translate(${px.toFixed(1)} 0)`);
      dot.setAttribute('cy', py);
      const [cx, cy] = rel(e);
      dashTip(card, `<b>${dashEsc(new Date(p.d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</b>${DASH_FMT.money(p.v)}`, cx, cy);
    });
    lc.addEventListener('mouseleave', () => { cross.style.opacity = 0; dashTip(card, ''); });
  }
  // PPC bars: the week glows, with sales, ad spend and TACoS
  el.querySelectorAll('.dash-week').forEach(w => {
    w.addEventListener('mouseenter', () => w.classList.add('is-on'));
    w.addEventListener('mousemove', e => {
      const rev = Number(w.dataset.rev), spend = Number(w.dataset.spend);
      const [x, y] = rel(e);
      dashTip(card, `<b>${dashEsc(w.dataset.w)}</b>Sales ${DASH_FMT.money(rev)} · Ad spend ${DASH_FMT.money(spend)} · TACoS ${rev ? Math.round(spend / rev * 100) + '%' : '—'}`, x, y);
    });
    w.addEventListener('mouseleave', () => { w.classList.remove('is-on'); dashTip(card, ''); });
  });
}

/* ================= BACKGROUND DOTS, CONFETTI, PAUSING ================= */
// About 40 slow dots behind the cards (a canvas). Only with motion, never on a phone, at most 30 frames a second, only while seen.
function dashDotsStart(root) {
  const cv = root.querySelector('.dash-dots');
  if (!cv || DASH.eng === 'none' || dashPhone() || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const D = { cv, ctx, pts: [], raf: 0, last: 0, w: 0, h: 0, col: '' };
  const size = () => {
    const r = cv.getBoundingClientRect(), dpr = Math.min(1.5, window.devicePixelRatio || 1);
    D.w = Math.max(1, r.width); D.h = Math.max(1, r.height);
    cv.width = Math.round(D.w * dpr); cv.height = Math.round(D.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    D.col = getComputedStyle(root).getPropertyValue('--brand').trim() || 'gray';
    if (!D.pts.length) D.pts = Array.from({ length: 40 }, () => ({ x: Math.random() * D.w, y: Math.random() * D.h, r: 0.8 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18, a: 0.15 + Math.random() * 0.3 }));
  };
  const frame = t => {
    D.raf = 0;
    if (!dashLive()) return;
    D.raf = requestAnimationFrame(frame);
    if (t - D.last < 33) return;
    D.last = t;
    ctx.clearRect(0, 0, D.w, D.h);
    ctx.fillStyle = D.col;
    D.pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -4) p.x = D.w + 4; else if (p.x > D.w + 4) p.x = -4;
      if (p.y < -4) p.y = D.h + 4; else if (p.y > D.h + 4) p.y = -4;
      ctx.globalAlpha = p.a;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  };
  try {
    size();
    D.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { try { size(); } catch (e) { /* next frame */ } }) : null;
    if (D.ro) D.ro.observe(cv);
    D.go = () => { if (!D.raf && dashLive()) D.raf = requestAnimationFrame(frame); };
    DASH.dots = D;
    D.go();
  } catch (e) { DASH.dots = null; }
}
function dashDotsStop() {
  const D = DASH.dots;
  if (!D) return;
  if (D.raf) cancelAnimationFrame(D.raf);
  if (D.ro) D.ro.disconnect();
  DASH.dots = null;
}
// Confetti, once a day, only for a real win: Sales MTD more than 50% above last year (complete days), fresh numbers, with motion on.
function dashParty() {
  if (DASH.eng === 'none' || DASH.partyDone || !dashLive()) return;
  const d = dashData('sales');
  if (d.state !== 'fresh' || !d.v.ml || (d.v.mc - d.v.ml) / d.v.ml <= 0.5) return;
  const today = new Date().toDateString();
  if (dashGet(DASH_LS.party) === today) { DASH.partyDone = true; return; }
  DASH.partyDone = true;
  dashSet(DASH_LS.party, today);
  const root = $('dashRoot');
  const cv = document.createElement('canvas');
  cv.className = 'dash-party';
  cv.setAttribute('aria-hidden', 'true');
  root.appendChild(cv);
  const r = cv.getBoundingClientRect(), ctx = cv.getContext('2d');
  cv.width = r.width; cv.height = r.height;
  const css = getComputedStyle(root), cols = ['--brand', '--accent', '--act', '--rev', '--violet-ink'].map(v => css.getPropertyValue(v).trim()).filter(Boolean);
  const bits = Array.from({ length: 110 }, () => ({ x: r.width / 2, y: r.height * 0.25, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4,
    w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now();
  const frame = t => {
    const p = (t - t0) / 1800;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (p >= 1 || !cv.isConnected) { cv.remove(); return; }
    bits.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.vy += 0.42; b.vx *= 0.99; b.rot += b.vr;
      ctx.save(); ctx.globalAlpha = 1 - p; ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
// The Dashboard's OWN animations (every one is kept in DASH.tw) stop and go again with the page. Never GSAP's whole clock
// (gsap.globalTimeline): the Sales Dashboard runs on the same GSAP, and pausing the clock froze every Sales entrance at its first
// frame — the page stayed empty with ✨ on when Sales was opened from the Dashboard (24 Nov 2026). Only what was running is held,
// so an entrance still waiting for its scroll is left to ScrollTrigger; a second stop adds to the held list, never empties it.
function dashHold(on) {
  if (on) { (DASH.held || []).forEach(t => { try { t.resume(); } catch (e) { /* killed meanwhile */ } }); DASH.held = []; return; }
  const run = Object.values(DASH.tw).flat().filter(t => t && typeof t.paused === 'function' && !t.paused());
  run.forEach(t => { try { t.pause(); } catch (e) { /* gone */ } });
  DASH.held = (DASH.held || []).concat(run);
}
// Run or stop every loop: the Dashboard's GSAP animations, the dots, the clock, the CSS loops — only while the Dashboard is on
// screen in a shown tab.
function dashLoops() {
  const on = dashLive();
  const pane = $('paneDash');
  if (pane) pane.classList.toggle('dash-paused', !on);
  if (window.gsap && DASH.gs === true) dashHold(on);
  if (DASH.dots) { if (on) DASH.dots.go(); }
  clearInterval(DASH.clockT);
  DASH.clockT = 0;
  if (on) DASH.clockT = setInterval(() => { const c = document.querySelector('#paneDash .dash-clock'); if (c) c.textContent = dashClockText(); }, 1000);
}

/* ================= OPENING A SCREEN FROM A CARD ================= */
// Listing Health opens with the level asked for (and the brand on view), exactly as its own level boxes set it.
function dashOpen(tab, level) {
  if (!dashMay(tab)) return;
  if (tab === 'health') {
    const pick = (id, v) => { const el = $(id); if (el && [...el.options].some(o => o.value === v)) el.value = v; };
    if (level) pick('hIssueView', level);
    pick('hBrandView', DASH.brand);
  }
  showTab(tab);
}

/* ================= THE SCREEN, THE SWITCH, THE LOGO, SIGN-IN ================= */
// Opening the Dashboard: drawn at once (fresh, cached or shimmering cards); the loads already running fill it as they land. The first
// time with ✨ on, GSAP is fetched — waited for at most 300 ms, after which the CSS motion is used for this drawing.
async function ensureDash() {
  if (!DASH_READY) return;
  dashPrefetch();
  if (dashFxOn() && DASH.gs == null) await Promise.race([dashGsap(), dashSleep(300)]);
  if ($('paneDash').classList.contains('hide')) return;
  try { dashRender(); } catch (e) { /* the page stays as it was */ }
  if (DASH.eng === 'css' && DASH.gsTry) DASH.gsTry.then(ok => { if (ok) dashGsUpgrade(); });
}
(() => {
  try {
    const saved = dashGet(DASH_LS.brand);
    if (saved === 'ALL' || saved === 'SP' || saved === 'CPC') DASH.brand = saved;
  } catch (e) { /* Both */ }
  const pane = $('paneDash');
  if (pane) pane.addEventListener('click', e => {
    const b = e.target.closest('[data-dash-brand]');
    if (b) {
      if (DASH.brand === b.dataset.dashBrand) return;
      DASH.brand = b.dataset.dashBrand;
      dashSet(DASH_LS.brand, DASH.brand);
      pane.querySelectorAll('[data-dash-brand]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      dashPill(true);
      dashPaint(DASH_SLOTS, 'brand');
      return;
    }
    const o = e.target.closest('[data-dash-open]');
    if (o && !o.disabled) dashOpen(o.dataset.dashOpen, o.dataset.dashLevel || '');
  });
  // the loops follow the page: another screen, or the tab hidden
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => dashLoops()).observe(pane, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => dashLoops());
  // the self-check: each time Listing Health draws its header
  const kpis = $('hKpis');
  let checkT = 0;
  if (kpis && typeof MutationObserver === 'function') new MutationObserver(() => {
    clearTimeout(checkT);
    checkT = setTimeout(() => { try { if (DASH.st.health && DASH.st.health.s === 'ok') dashHealthCheck(); } catch (e) { /* a check only */ } }, 400);
  }).observe(kpis, { childList: true });
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
