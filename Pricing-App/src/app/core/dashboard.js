/* ================= CORE · DASHBOARD: the first screen after sign-in (20 Nov 2026) =================
 * Screens: Dashboard (tab 'dash', #paneDash; core/nav.js calls ensureDash when it opens), the Sellora logo in the top bar (opens
 *          it) and the ✨ button beside the theme switch (#fxBtn: the Dashboard's animation on / off — nothing on any other
 *          screen moves or stops with it).
 * Does: shows, for Both / Ridhi / CPC (remembered in this browser), numbers the other screens ALREADY hold — never one of its own:
 *   Sales MTD / YTD, 90 days   the Sales Dashboard's nightly history (SD, else this browser's saved copy of it, sd.daily.v1), with
 *                              Seller Central's own day totals laid over it when they are in memory (tMatchBizDays) — the very sums
 *                              renderSales makes, with its "vs LY" on complete days;
 *   Ad spend, TACoS, 8 weeks   the PPC & Organic weekly store (WEEKLY once that screen has loaded it, else ONE read of the same saved
 *                              Firestore snapshot — audit/weekly + weeklyrows/n — into the Dashboard's own copy; WEEKLY is never
 *                              written here), latest week as renderWeeklyKpis takes it, only the account's ad brands (adBrands);
 *   Listings, flow, donut      Listing Health's own judgement of its snapshot (HEALTH · hCtx · hHealthKept, the levels of
 *                              renderHealthKpis), once that data is in memory; the flow's last two boxes are Listing History's log
 *                              for this month (LH.rows · lhFiltered): listings sent after approval, and listings Amazon accepted;
 *   the four tiles             Image Manager's listings that need pictures (IML · imProblems · IM_NEEDS), Listing Errors' listings
 *                              with an error (its "Errors only" list), BSR Audit's "Got worse" card (BSR_RENDER.all) and Inventory
 *                              Age's aged 181+ units and storage (AGE; loadAgeCache — the saved Firestore snapshot — when not loaded).
 *   A number not in memory shows "—" with "open the screen". The listing numbers last worked out are kept in this browser
 *   (selloraDash.v1) and shown with the time they are from ("as of …", amber) until those screens are open again.
 * NEVER: an Amazon call, a Refresh, Apps Script (baCall), AI, or a write anywhere but this browser's localStorage. A card shows only
 *        when this account may open its screen (TAB_OK).
 * Look: cards fade up one after another, numbers count up (~800 ms, always ending on the exact text), the donut, line and bars draw
 *       in, a dot runs along the flow, a soft glow drifts behind (styles.css, DASHBOARD). ✨ off, or the computer asking for reduced
 *       motion: the same cards and numbers, still. Everything is drawn as text first, so a failed animation leaves a whole page.
 * Main functions: ensureDash, dashRender, dashPaint, dashSales, dashAds, dashHealth, dashPart, dashTiles, dashOpen, dashCount. */

// var, not const: core/nav.js's load-time showTab calls ensureDash before this file has run (it waits for this).
var DASH_READY = false;
const DASH_LS = { brand: 'selloraDashBrand', fx: 'selloraDashFx', saved: 'selloraDash.v1' };
const DASH = { brand: 'ALL', weekly: null, weeklyBusy: false, ageBusy: false, warmBusy: false, cu: [], raf: 0, safety: 0, keep: null };
const DASH_NUM = new Intl.NumberFormat('en-US');
const DASH_FMT = {
  money: v => '$' + DASH_NUM.format(Math.round(v)),         // the Sales Dashboard's sdMoney: whole dollars
  usd2: v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),   // Inventory Age's storage
  num: v => DASH_NUM.format(Math.round(v)),
  pct: v => Math.round(v) + '%',
};
const DASH_SLOTS = ['kSales', 'kYtd', 'kAds', 'kList', 'flow', 'donut', 'line', 'bars', 'tImg', 'tErr', 'tBsr', 'tAge'];
const dashEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const dashGet = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const dashSet = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* private window: not remembered */ } };
const dashBrands = () => (DASH.brand === 'ALL' ? ['SP', 'CPC'] : [DASH.brand]);
const dashName = b => (b === 'SP' ? 'Ridhi' : b);
// May this account open screen t? (TAB_OK is set by core/access.js applyPerms once the account's rights are known.)
const dashMay = t => typeof TAB_OK === 'function' && !!TAB_OK(t);
const dashWhen = d => {
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t) ? '' : t.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const dashReduce = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
const dashFxSaved = () => dashGet(DASH_LS.fx) !== '0';
const dashFxOn = () => dashFxSaved() && !dashReduce();
const dashShown = () => !!$('paneDash') && !$('paneDash').classList.contains('hide');

/* ---------- the saved copy of the listing numbers (this browser only) ---------- */
function dashSaved() {
  try { return JSON.parse(dashGet(DASH_LS.saved) || '{}') || {}; } catch (e) { return {}; }
}
// One brand's part, worked out now: remembered at the end of this paint (dashFlush).
function dashKeep(part, brand, value) {
  if (!DASH.keep) DASH.keep = {};
  (DASH.keep[part] || (DASH.keep[part] = {}))[brand] = Object.assign({ at: Date.now() }, value);
}
function dashFlush() {
  if (!DASH.keep) return;
  const saved = dashSaved();
  Object.entries(DASH.keep).forEach(([part, byBrand]) => { saved[part] = Object.assign(saved[part] || {}, byBrand); });
  DASH.keep = null;
  dashSet(DASH_LS.saved, JSON.stringify(saved));
}
/* One per-brand part for the brands on view: fresh(brand) → { …numbers, when } or null (not in memory). A brand not in memory falls
 * back to its saved copy ("as of …"). → { deny } | null (some brand has neither) | { v: { field: sum }, when, old, per } */
function dashPart(part, tab, fresh) {
  if (!dashMay(tab)) return { deny: true };
  const saved = dashSaved()[part] || {};
  const per = {};
  for (const b of dashBrands()) {
    let got = null;
    try { got = fresh(b); } catch (e) { got = null; }
    if (got) {
      dashKeep(part, b, got);
      per[b] = Object.assign({ old: false }, got);
    } else if (saved[b]) per[b] = Object.assign({}, saved[b], { old: true });
    else return null;
  }
  const list = Object.values(per);
  const v = {};
  list.forEach(x => Object.keys(x).forEach(k => {
    if (typeof x[k] === 'number' && k !== 'at') v[k] = (v[k] || 0) + x[k];
  }));
  const old = list.some(x => x.old);
  const whens = [...new Set(list.map(x => x.when || ''))];
  const when = old ? 'as of ' + dashWhen(Math.min(...list.filter(x => x.old).map(x => x.at)))
    : whens.length === 1 ? whens[0] : dashBrands().map(b => dashName(b) + ': ' + (per[b].when || '—')).join(' · ');
  return { v, when, old, per };
}

/* ---------- SALES: the Sales Dashboard's sums ---------- */
// The nightly history the Sales Dashboard holds, else this browser's saved copy of it (read only — SD is never set from here).
function dashSalesSrc() {
  if (!dashMay('sales')) return { deny: true };
  if (SD && SD.at) return { d: SD.d || {}, at: SD.at, live: SD_LIVE || '' };
  try {
    const saved = JSON.parse(dashGet(SD_LS) || 'null');
    if (saved && saved.at && saved.d) return { d: saved.d, at: saved.at, live: saved.live || '', local: true };
  } catch (e) { /* no saved copy */ }
  return null;
}
// renderSales's numbers for the brands on view (Amazon only: Ridhi, CPC): MTD and YTD with "vs LY" on complete days, and 90 days.
function dashSales() {
  const src = dashSalesSrc();
  if (!src || src.deny) return src;
  // sdDays, on this history: Seller Central's own day totals win for the Amazon accounts while they are in memory
  const daysOf = chan => {
    const own = src.d[chan] || {};
    const amz = typeof tMatchBizDays === 'function' ? tMatchBizDays(chan) : {};
    const keys = Object.keys(amz);
    if (!keys.length) return own;
    const out = Object.assign({}, own);
    keys.forEach(day => { const v = amz[day]; out[day] = [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]; });
    return out;
  };
  const chans = dashBrands().map(b => daysOf(b));
  const sum = (from, to) => {
    let total = 0;
    chans.forEach(byDay => Object.keys(byDay).forEach(day => { if (day >= from && day <= to) total += (byDay[day] || [])[0] || 0; }));
    return Math.round(total * 100) / 100;
  };
  const today = sdToday();
  const yest = sdShift(today, -1);
  const monthStart = today.slice(0, 8) + '01';
  const yearStart = today.slice(0, 4) + '-01-01';
  // sdDelta's words: "▲12.3%" / "▼4.5%", nothing without a baseline
  const delta = (now, was) => (was ? { up: now >= was, txt: (now < was ? '▼' : '▲') + Math.abs((now - was) / was * 100).toFixed(1) + '%' } : null);
  const series = {};
  const from90 = sdShift(today, -89);
  chans.forEach(byDay => Object.entries(byDay).forEach(([day, f]) => { if (day >= from90 && day <= today) series[day] = (series[day] || 0) + ((f || [])[0] || 0); }));
  const T = typeof T_MATCH !== 'undefined' && T_MATCH.biz;
  return {
    mtd: sum(monthStart, today), ytd: sum(yearStart, today),
    mtdD: delta(sum(monthStart, yest), sum(sdLastYear(monthStart), sdLastYear(yest))),
    ytdD: delta(sum(yearStart, yest), sum(sdLastYear(yearStart), sdLastYear(yest))),
    pts: Object.keys(series).sort().map(d => ({ d, v: series[d] })),
    when: (src.local ? 'saved copy · ' : '') + 'nightly run ' + src.at + (src.live ? ' · today ' + src.live : '') + (T ? ' · Seller Central totals' : ''),
  };
}

/* ---------- ADS: the PPC & Organic weekly store ---------- */
// The same saved snapshot loadWeekly reads (audit/weekly + weeklyrows/n), into the Dashboard's own copy.
async function dashWeeklyRead() {
  const meta = await getDoc(doc(db, 'audit', 'weekly'));
  if (!meta.exists()) return { weeks: [], rows: {}, at: '', adAt: '' };
  const d = meta.data();
  const rows = {};
  if (d.chunks) {
    const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'weeklyrows', String(i)))));
    got.forEach(s => { if (s.exists()) Object.assign(rows, s.data().r || {}); });
  }
  return { weeks: d.weeks || [], rows, at: d.at || '', adAt: d.adAt || '' };
}
// Per week of the last 8: sales and ad spend of the brands on view this account may see; the latest week's TACoS as renderWeeklyKpis.
function dashAds() {
  if (!dashMay('ppcn') && !dashMay('weekly')) return { deny: true };
  const ad = typeof adBrands === 'function' ? adBrands() : ['SP', 'CPC'];
  const bs = dashBrands().filter(b => ad.includes(b));
  if (!bs.length) return { deny: true };
  let W = null;
  if (WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length) W = WEEKLY;
  else if (DASH.weekly) W = DASH.weekly;
  else {
    if (!DASH.weeklyBusy) {
      DASH.weeklyBusy = true;
      dashWeeklyRead().then(w => { DASH.weekly = w; }, () => { DASH.weekly = { weeks: [], rows: {}, at: '', adAt: '', failed: true }; })
        .then(() => { DASH.weeklyBusy = false; if (dashShown()) dashPaint(['kAds', 'bars'], true); });
    }
    return { loading: true };
  }
  if (!Object.keys(W.rows).length) return null;
  // wRows: "All" keeps every row; one brand keeps its rows
  const all = bs.length === 2;
  const rows = Object.values(W.rows).filter(r => all || bs.includes(r.brand || ''));
  const weeks = (W.weeks.length ? W.weeks : wWeeksList(26)).slice(-8);
  const per = weeks.map(w => {
    let rev = 0, spend = 0;
    rows.forEach(r => { const c = (r.weeks || {})[w]; if (c) { rev += c.rev || 0; spend += c.spend || 0; } });
    return { w, rev, spend, done: wWeekDone(w) };
  });
  const last = per[per.length - 1];
  return {
    per, last, tacos: last && last.rev ? Math.round(last.spend / last.rev * 100) : null,
    only: bs.length < dashBrands().length ? bs.map(dashName).join(', ') + ' only' : '',
    when: (W.at ? 'sales as at ' + W.at : 'not pulled yet') + (W.adAt ? ' · ads ' + W.adAt : ''),
  };
}

/* ---------- LISTINGS: Listing Health's levels, Listing History this month ---------- */
// One brand, as renderHealthKpis counts it; null while Listing Health's snapshot is not in memory or is still to be judged. The
// saved rules must be in too (LR, lrLoad): another screen can load the snapshot alone, and the defaults would judge differently.
function dashHealthOf(brand) {
  if (!H_LOADED || !LR || !HEALTH[brand]) return null;
  if (hColdMany()) {
    // many listings still to judge: in slices first (hWarm, as Listing Health does), then these cards again
    if (!DASH.warmBusy) {
      DASH.warmBusy = true;
      Promise.resolve(hWarm()).catch(() => {}).then(() => { DASH.warmBusy = false; if (dashShown()) dashPaint(['kList', 'flow', 'donut'], true); });
    }
    return null;
  }
  const hc = hCtx();
  const now = Date.now();
  const c = { n: 0, critical: 0, action: 0, review: 0, healthy: 0, unchecked: 0 };
  HEALTH[brand].rows.forEach(row => {
    const h = hHealthKept(row, Object.assign({}, row, { brand }), hc, now);
    c.n++;
    if (h.bucket === 'healthy' || h.bucket === 'monitor') c.healthy++;
    else if (h.bucket in c) c[h.bucket]++;
  });
  const lm = typeof lmDataLabel === 'function' ? lmDataLabel([brand]) : null;
  c.when = lm ? lm.text : HEALTH[brand].at ? 'updated ' + dashWhen(HEALTH[brand].at) : '';
  return c;
}
const dashHealth = () => dashPart('health', 'health', dashHealthOf);
// This month in Listing History: listings sent after approval, and listings Amazon accepted.
const dashLh = () => dashPart('lh', 'lhist', brand => {
  if (!Array.isArray(LH.rows) || LH.loading || LH.err) return null;
  const rows = lhFiltered(LH.rows, { range: 'month', from: '', to: '', user: '', what: '', screen: '', result: '', q: '' }).filter(r => r.brand === brand);
  return { fixed: new Set(rows.filter(r => r.result !== 'notsent').map(r => r.sku)).size,
    amz: new Set(rows.filter(r => r.result === 'accepted').map(r => r.sku)).size, when: 'this month · Listing History' };
});

/* ---------- the four tiles ---------- */
const dashSnapWhen = brand => {
  const lm = typeof lmDataLabel === 'function' ? lmDataLabel([brand]) : null;
  return lm ? lm.text : IML[brand] && IML[brand].at ? 'snapshot ' + dashWhen(IML[brand].at) : '';
};
// Image Manager: the child listings that need pictures (the "N need pictures" of its families).
const dashImgs = () => dashPart('img', 'img', brand => {
  const data = IML[brand];
  if (!data || !Array.isArray(data.items)) return null;
  const n = data.items.filter(it => it.lvl !== 'parent' && imProblems(it, brand).some(k => IM_NEEDS.includes(k))).length;
  return { n, when: dashSnapWhen(brand) };
});
// Listing Errors: the child listings with at least one of Amazon's errors (its "Errors only" list).
const dashErrs = () => dashPart('lerr', 'lerr', brand => {
  const data = IML[brand];
  if (!data || !Array.isArray(data.items)) return null;
  const n = data.items.filter(x => x.lvl !== 'parent' && ((x.iss || []).some(i => i.s === 'E') || (!!x.ie && !x.iss))).length;
  return { n, when: dashSnapWhen(brand) };
});
// BSR Audit: the "Got worse" card of the compare it drew last (BSR_RENDER.all), for the brands it compared.
const dashBsr = () => dashPart('bsr', 'bsr', brand => {
  const all = BSR_LOADED && BSR_RENDER && Array.isArray(BSR_RENDER.all) ? BSR_RENDER.all : null;
  if (!all || !all.length) return null;
  const pick = $('bBrandView') ? $('bBrandView').value : 'ALL';
  if (pick !== 'ALL' && pick !== brand) return null;
  const n = all.filter(r => r.brand === brand && r.move === 'worse').length;
  const high = all.filter(r => r.brand === brand && r.move === 'worse' && r.prio && r.prio.p === 'High').length;
  const wA = $('bWeekA') ? $('bWeekA').value : '', wB = $('bWeekB') ? $('bWeekB').value : '';
  return { n, high, when: wA && wB ? wA + ' vs ' + wB : 'BSR Audit' };
});
// Inventory Age: aged 181+ units and the storage charge, as renderAgeKpis adds them up (the saved snapshot, read once if not loaded).
function dashAge() {
  if (!dashMay('age')) return { deny: true };
  if (!AGE_LOADED) {
    if (!DASH.ageBusy) {
      DASH.ageBusy = true;
      Promise.resolve(loadAgeCache()).catch(() => {}).then(() => { DASH.ageBusy = false; if (dashShown()) dashPaint(['tAge'], true); });
    }
    return { loading: true };
  }
  const bs = dashBrands().filter(b => AGE[b]);
  if (!bs.length) return null;
  const cols = totalCols([...new Set(bs.flatMap(b => AGE[b].cols))]);
  const aged = cols.filter(c => { const r = ageRange(c); return r && r[0] >= AGED_FROM; });
  let units = 0, storage = 0;
  bs.forEach(b => AGE[b].rows.forEach(r => {
    units += aged.reduce((s, c) => s + ((r.age || {})[c] || 0), 0);
    storage += r.storage || 0;
  }));
  const ats = bs.map(b => AGE[b].at).filter(Boolean);
  return { units, storage, only: bs.length < dashBrands().length ? bs.map(dashName).join(', ') + ' only' : '',
    when: ats.length ? 'updated ' + dashWhen(new Date(Math.min(...ats.map(d => d.getTime())))) : '' };
}

/* ---------- drawing ---------- */
const dashOpenBtn = (tab, extra) => (dashMay(tab) ? `<button type="button" class="dash-open" data-dash-open="${tab}"${extra || ''}>Open →</button>` : '');
// The line under a card: its "updated", or why there is no number.
function dashFoot(res, tab, when) {
  if (res && res.deny) return '<div class="dash-w">not in your access</div>';
  if (res && res.loading) return '<div class="dash-w">reading the saved snapshot…</div>';
  if (!res) return `<div class="dash-w">not loaded yet · <button type="button" class="dash-go" data-dash-open="${tab}">open the screen</button></div>`;
  return `<div class="dash-w${res.old ? ' is-old' : ''}" title="${dashEsc(when)}">${dashEsc(when)}</div>`;
}
// A number that counts up: the exact text is there from the start; dashCount only animates towards it.
const dashCu = (v, fmt, tag) => `<${tag || 'span'} data-cu="${Number(v) || 0}" data-fmt="${fmt}">${dashEsc(DASH_FMT[fmt](v))}</${tag || 'span'}>`;
const dashDelta = d => (d ? `<span class="${d.up ? 'dash-up' : 'dash-dn'}">${d.txt}</span> vs LY` : '<span>— vs LY</span>');

function dashKpi(i, icon, label, tab, res, valueHtml, subHtml) {
  const ok = res && !res.deny && !res.loading;
  return `<article class="dash-card dash-kpi" style="--i:${i}">
    <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${label}</span>${dashOpenBtn(tab)}</div>
    <div class="dash-v${ok ? '' : ' is-none'}">${ok ? valueHtml : '—'}</div>
    <div class="dash-s">${ok ? subHtml || '' : ''}</div>
    ${dashFoot(res, tab, ok ? res.when : '')}</article>`;
}

// Each slot's HTML. `c` holds the sources worked out once per paint; `i` is the card's place in the stagger.
const DASH_PAINT = {
  kSales: (c, i) => dashKpi(i, '💰', 'Sales MTD', 'sales', c.sales(), c.sales() && c.sales().mtd != null ? dashCu(c.sales().mtd, 'money') : '',
    c.sales() && dashDelta(c.sales().mtdD) + ' <span>· complete days</span>'),
  kYtd: (c, i) => dashKpi(i, '📈', 'Sales YTD', 'sales', c.sales(), c.sales() && c.sales().ytd != null ? dashCu(c.sales().ytd, 'money') : '',
    c.sales() && dashDelta(c.sales().ytdD) + ' <span>· complete days</span>'),
  kAds: (c, i) => {
    const a = c.ads();
    const ok = a && !a.deny && !a.loading && a.last;
    return dashKpi(i, '📢', 'Ad spend · latest week', 'ppcn', a && (a.deny || a.loading || ok) ? a : null, ok ? dashCu(a.last.spend, 'money') : '',
      ok ? `<span>TACoS <b class="${a.tacos != null && a.tacos > 20 ? 'dash-bad' : ''}">${a.tacos == null ? '—' : a.tacos + '%'}</b></span>`
        + `<span>${dashEsc(wLabel(a.last.w))}${a.last.done ? '' : ' · ' + wDaysIn(a.last.w) + '/7 days'}</span>${a.only ? `<span>${dashEsc(a.only)}</span>` : ''}` : '');
  },
  kList: (c, i) => {
    const h = c.health();
    const ok = h && !h.deny;
    return dashKpi(i, '🩺', 'Listings', 'health', h, ok ? dashCu(h.v.n, 'num') : '',
      ok ? `<span><b class="dash-bad">${DASH_FMT.num(h.v.critical)}</b> critical</span><span>${DASH_FMT.num(h.v.action + h.v.review)} to review</span>` : '');
  },
  flow: (c, i) => {
    const h = c.health();
    const l = c.lh();
    const hv = h && !h.deny ? h.v : null;
    const lv = l && !l.deny ? l.v : null;
    const step = (s, cls, label, v, sub, tab, level) => {
      const go = dashMay(tab);
      return `<button type="button" class="dash-step ${cls}" style="--s:${s}"${go ? ` data-dash-open="${tab}"${level ? ` data-dash-level="${level}"` : ''}` : ' disabled'}`
        + ` title="${dashEsc(label)}${go ? ' — open' : ''}"><span class="dash-step-l">${dashEsc(label)}</span>`
        + `<b>${v == null ? '—' : dashCu(v, 'num')}</b><small>${dashEsc(sub)}</small></button>`;
    };
    const arrow = s => `<span class="dash-arrow" style="--s:${s}" aria-hidden="true"><svg viewBox="0 0 44 12"><path pathLength="1" d="M3 6H39"/><path pathLength="1" d="M34 1.5 39.5 6 34 10.5"/></svg></span>`;
    // the line under it: Listing Health's time, then Listing History's (or that it is not loaded yet)
    const foot = !h || h.deny ? dashFoot(h, 'health', '')
      : dashFoot({ old: h.old || !!(l && l.old) }, 'health', [...new Set([h.when, l && !l.deny ? l.when : l && l.deny ? '' : 'Listing History not loaded yet'])].filter(Boolean).join(' · '));
    return `<article class="dash-card dash-flowcard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🔁</span>Listing flow</span>${dashOpenBtn('health')}</div>
      <div class="dash-flowrow">
        <div class="dash-track" aria-hidden="true"><span class="dash-runner"><i></i></span></div>
        ${step(0, '', 'All listings', hv ? hv.n : null, 'in Listing Health', 'health', 'ALL')}${arrow(0)}
        ${step(1, 'is-act', 'Problems found', hv ? hv.critical + hv.action + hv.review : null, 'critical · action · review', 'health', 'ALL')}${arrow(1)}
        ${step(2, 'is-bad', 'Critical', hv ? hv.critical : null, 'fix first', 'health', 'critical')}${arrow(2)}
        ${step(3, 'is-brand', 'Fixed / Approved', lv ? lv.fixed : null, 'sent this month', dashMay('lhist') ? 'lhist' : 'health')}${arrow(3)}
        ${step(4, 'is-ok', 'On Amazon', lv ? lv.amz : null, 'accepted this month', dashMay('lhist') ? 'lhist' : 'health')}
      </div>
      ${foot}</article>`;
  },
  donut: (c, i) => {
    const h = c.health();
    const ok = h && !h.deny;
    const C = 'is-c', A = 'is-a', R = 'is-r', H = 'is-h', U = 'is-u';
    const one = b => {
      const x = h.per[b];
      const parts = [[C, x.critical], [A, x.action], [R, x.review], [H, x.healthy], [U, x.unchecked || 0]];
      const total = parts.reduce((s, p) => s + p[1], 0) || 1;
      let at = 0;
      const segs = parts.filter(p => p[1] > 0).map(([cls, n]) => {
        const len = n / total * 100;
        const seg = `<circle class="dash-seg ${cls}" cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="${Math.max(0, len - (len > 1.2 ? 0.6 : 0)).toFixed(2)} 100" stroke-dashoffset="${(-at).toFixed(2)}"><title>${DASH_FMT.num(n)}</title></circle>`;
        at += len;
        return seg;
      }).join('');
      return `<figure class="dash-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${dashEsc(dashName(b))}: ${x.critical} critical, ${x.action} needs action, ${x.review} review, ${x.healthy} healthy">`
        + `<defs><mask id="dashMask${b}"><circle class="dash-dm" cx="60" cy="60" r="44" pathLength="1" stroke="white" transform="rotate(-90 60 60)"/></mask></defs>`
        + `<g mask="url(#dashMask${b})"><g transform="rotate(-90 60 60)">${segs}</g></g>`
        + `<text class="dash-mid" x="60" y="62" text-anchor="middle">${dashCu(x.n, 'num', 'tspan')}</text><text class="dash-midl" x="60" y="77" text-anchor="middle">listings</text></svg>`
        + `<figcaption>${dashEsc(dashName(b))}</figcaption><div class="dash-mini">`
        + [[C, x.critical], [A, x.action], [R, x.review], [H, x.healthy]].map(([cls, n]) => `<span><i class="dash-dot ${cls}"></i>${DASH_FMT.num(n)}</span>`).join('')
        + '</div></figure>';
    };
    const anyU = ok && dashBrands().some(b => h.per[b].unchecked);
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🍩</span>Listing Health</span>${dashOpenBtn('health')}</div>
      ${ok ? `<div class="dash-donuts">${dashBrands().map(one).join('')}</div>
      <div class="dash-key"><span><i class="dash-dot is-c"></i>Critical</span><span><i class="dash-dot is-a"></i>Needs Action</span><span><i class="dash-dot is-r"></i>Review</span><span><i class="dash-dot is-h"></i>Healthy</span>${anyU ? '<span><i class="dash-dot is-u"></i>Not checked</span>' : ''}</div>` : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(h, 'health', ok ? h.when : '')}</article>`;
  },
  line: (c, i) => {
    const s = c.sales();
    const ok = s && !s.deny && s.pts && s.pts.length;
    let svg = '';
    if (ok) {
      const pts = s.pts;
      const W = 300, H = 120, L = 4, R = 4, T = 8, B = 18;
      const max = Math.max(1, ...pts.map(p => p.v));
      const x = k => L + (pts.length === 1 ? (W - L - R) / 2 : k / (pts.length - 1) * (W - L - R));
      const y = v => T + (H - T - B) - v / max * (H - T - B);
      const line = pts.map((p, k) => (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
      const area = `M${x(0).toFixed(1)} ${H - B} ` + pts.map((p, k) => 'L' + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') + ` L${x(pts.length - 1).toFixed(1)} ${H - B} Z`;
      const short = iso => String(Number(iso.slice(8, 10))) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1];
      svg = `<svg class="dash-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales, last 90 days">`
        + `<line class="dash-base" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`
        + `<path class="dash-area" d="${area}"/><path class="dash-line" pathLength="1" d="${line}"/>`
        + `<text class="dash-axis" x="${L}" y="${H - 4}">${short(pts[0].d)}</text><text class="dash-axis" x="${W - R}" y="${H - 4}" text-anchor="end">${short(pts[pts.length - 1].d)}</text>`
        + `<text class="dash-axis" x="${W - R}" y="${T + 2}" text-anchor="end">top day ${DASH_FMT.money(max)}</text></svg>`;
    }
    const total = ok ? s.pts.reduce((t, p) => t + p.v, 0) : 0;
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📊</span>Sales · last 90 days</span>${dashOpenBtn('sales')}</div>
      ${ok ? `<div class="dash-s"><b>${dashCu(total, 'money')}</b><span>in 90 days</span></div>${svg}` : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(ok ? s : s && (s.deny || s.loading) ? s : null, 'sales', ok ? s.when : '')}</article>`;
  },
  bars: (c, i) => {
    const a = c.ads();
    const ok = a && !a.deny && !a.loading && a.per && a.per.length;
    let svg = '';
    if (ok) {
      const W = 300, H = 130, T = 6, B = 18;
      const n = a.per.length;
      const gw = W / n;
      const bw = Math.min(14, gw * 0.32);
      const max = Math.max(1, ...a.per.map(p => Math.max(p.rev, p.spend)));
      const h = v => v / max * (H - T - B);
      svg = `<svg class="dash-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and ad spend, last ${n} weeks">`
        + `<line class="dash-base" x1="0" y1="${H - B}" x2="${W}" y2="${H - B}"/>`
        + a.per.map((p, k) => {
          const cx = gw * k + gw / 2;
          const run = p.done ? '' : ' is-run';
          const tip = `${wLabel(p.w)}${p.done ? '' : ' (still running)'} — sales ${DASH_FMT.money(p.rev)}, ad spend ${DASH_FMT.money(p.spend)}`;
          return `<g><title>${dashEsc(tip)}</title>`
            + `<rect class="dash-bar is-sales${run}" style="--b:${k * 2}" x="${(cx - bw - 1).toFixed(1)}" y="${(H - B - h(p.rev)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.rev).toFixed(1)}" rx="2"/>`
            + `<rect class="dash-bar is-spend${run}" style="--b:${k * 2 + 1}" x="${(cx + 1).toFixed(1)}" y="${(H - B - h(p.spend)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.spend).toFixed(1)}" rx="2"/>`
            + `<text class="dash-axis" x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${dashEsc(wLabel(p.w).split('-')[0])}</text></g>`;
        }).join('') + '</svg>';
    }
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📦</span>PPC · weekly</span>${dashOpenBtn('ppcn')}</div>
      ${ok ? `<div class="dash-key" style="justify-content:flex-start"><span><i class="dash-dot is-sales"></i>Sales</span><span><i class="dash-dot is-spend"></i>Ad spend</span>${a.only ? `<span>${dashEsc(a.only)}</span>` : ''}</div>${svg}` : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(ok ? a : a && (a.deny || a.loading) ? a : null, 'ppcn', ok ? a.when : '')}</article>`;
  },
  tImg: (c, i) => dashTile(i, '🖼', 'Need pictures', 'img', c.img(), r => dashCu(r.v.n, 'num'), () => 'listings · Image Manager', r => r.v.n > 0),
  tErr: (c, i) => dashTile(i, '⚠️', 'Listing errors', 'lerr', c.err(), r => dashCu(r.v.n, 'num'), () => 'listings with an Amazon error', r => r.v.n > 0),
  tBsr: (c, i) => dashTile(i, '📉', 'BSR got worse', 'bsr', c.bsr(), r => dashCu(r.v.n, 'num'), r => `parents · ${DASH_FMT.num(r.v.high || 0)} high priority`, r => r.v.n > 0),
  tAge: (c, i) => dashTile(i, '⏳', 'Aged 181+ units', 'age', c.age(), r => dashCu(r.units, 'num'),
    r => (r.storage ? dashCu(r.storage, 'usd2') : '—') + ' storage' + (r.only ? ' · ' + dashEsc(r.only) : ''), r => r.units > 0),
};
// A "needs attention" tile: the whole tile opens its screen; it pulses softly while its number is above 0.
function dashTile(i, icon, label, tab, res, big, more, hot) {
  const ok = res && !res.deny && !res.loading;
  const go = dashMay(tab);
  return `<button type="button" class="dash-card dash-tile${ok && hot(res) ? ' is-hot' : ''}" style="--i:${i}"${go ? ` data-dash-open="${tab}"` : ' disabled'}>
    <span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${dashEsc(label)}</span>
    <b>${ok ? big(res) : '—'}</b><span class="dash-more">${ok ? more(res) : ''}</span>
    ${res && res.deny ? '<span class="dash-w">not in your access</span>' : res && res.loading ? '<span class="dash-w">reading the saved snapshot…</span>'
      : !res ? '<span class="dash-w">not loaded yet · open the screen</span>' : `<span class="dash-w${res.old ? ' is-old' : ''}">${dashEsc(res.when)}</span>`}
    ${go ? '<span class="dash-open">Open →</span>' : ''}</button>`;
}

// The sources, worked out at most once per paint.
function dashSources() {
  const memo = {};
  const once = (k, fn) => () => {
    if (!(k in memo)) { try { memo[k] = fn(); } catch (e) { memo[k] = null; } }
    return memo[k];
  };
  return { sales: once('sales', dashSales), ads: once('ads', dashAds), health: once('health', dashHealth), lh: once('lh', dashLh),
    img: once('img', dashImgs), err: once('err', dashErrs), bsr: once('bsr', dashBsr), age: once('age', dashAge) };
}
// Draw these slots. quick: a slot filled later (a snapshot landed) animates straight away, not at its place in the stagger.
function dashPaint(ids, quick) {
  const c = dashSources();
  const fx = dashFxOn();
  if ($('paneDash')) $('paneDash').classList.toggle('dash-fx', fx);
  ids.forEach(id => {
    const el = $('dash-' + id);
    if (!el) return;
    let html;
    try { html = DASH_PAINT[id](c, quick ? 0 : DASH_SLOTS.indexOf(id)); } catch (e) { html = '<article class="dash-card"><div class="dash-v is-none">—</div></article>'; }
    el.innerHTML = html;
    if (fx) dashCount(el, quick ? 0 : DASH_SLOTS.indexOf(id));
  });
  try { dashFlush(); } catch (e) { /* not remembered */ }
}
// The whole page: greeting, date, brand switch, then every slot.
function dashRender() {
  const root = $('dashRoot');
  if (!root) return;
  dashStop();
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = (typeof sqName === 'function' ? sqName(ME.email) : '').split(' ')[0];
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const brand = (v, t) => `<button type="button" data-dash-brand="${v}" aria-pressed="${DASH.brand === v}">${t}</button>`;
  const slot = id => `<div class="dash-slot" id="dash-${id}"></div>`;
  root.innerHTML = '<div class="dash-glow" aria-hidden="true"><i></i><i></i><i></i></div>'
    + `<header class="dash-hero"><div><h3 class="dash-hi">${hi}${who ? ', ' + dashEsc(who) : ''}</h3><div class="dash-date">${dashEsc(date)}</div></div>`
    + `<div class="dash-brands" role="group" aria-label="Brand">${brand('ALL', 'Both')}${brand('SP', 'Ridhi')}${brand('CPC', 'CPC')}</div></header>`
    + `<section class="dash-grid dash-kpis">${['kSales', 'kYtd', 'kAds', 'kList'].map(slot).join('')}</section>`
    + `<section class="dash-grid">${slot('flow')}</section>`
    + `<section class="dash-grid dash-row3">${['donut', 'line', 'bars'].map(slot).join('')}</section>`
    + `<section class="dash-grid dash-tiles">${['tImg', 'tErr', 'tBsr', 'tAge'].map(slot).join('')}</section>`;
  dashPaint(DASH_SLOTS, false);
}

/* ---------- the count-up: ~800 ms from 0, each frame in the number's own format, the LAST frame its exact text ---------- */
function dashCount(root, i) {
  const now = performance.now();
  root.querySelectorAll('[data-cu]').forEach(el => {
    const v = Number(el.dataset.cu);
    const fmt = DASH_FMT[el.dataset.fmt];
    if (!(v > 0) || !fmt) return;
    const end = el.textContent;
    el.textContent = fmt(0);
    DASH.cu.push({ el, v, fmt, end, t0: now + i * 80 + 160 });
  });
  if (!DASH.cu.length) return;
  if (!DASH.raf) DASH.raf = requestAnimationFrame(dashTick);
  // a frame that never comes (a hidden tab): every number shows its exact text anyway
  clearTimeout(DASH.safety);
  DASH.safety = setTimeout(dashStop, 3000);
}
function dashTick(t) {
  DASH.raf = 0;
  DASH.cu = DASH.cu.filter(x => {
    if (!x.el.isConnected) return false;
    const p = Math.min(1, Math.max(0, (t - x.t0) / 800));
    if (p >= 1) { x.el.textContent = x.end; return false; }
    x.el.textContent = x.fmt(x.v * (1 - Math.pow(1 - p, 3)));
    return true;
  });
  if (DASH.cu.length) DASH.raf = requestAnimationFrame(dashTick);
}
// Stop counting: every number its exact text, now.
function dashStop() {
  if (DASH.raf) cancelAnimationFrame(DASH.raf);
  DASH.raf = 0;
  DASH.cu.forEach(x => { x.el.textContent = x.end; });
  DASH.cu = [];
  clearTimeout(DASH.safety);
}

/* ---------- opening a screen from a card ---------- */
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

/* ---------- the screen, the switch, the logo ---------- */
// Opening the Dashboard: drawn at once from what is in memory; a saved snapshot still on its way fills its card when it lands.
function ensureDash() {
  if (!DASH_READY) return;
  try { dashRender(); } catch (e) { /* the page stays as it was */ }
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
      DASH.brand = b.dataset.dashBrand;
      dashSet(DASH_LS.brand, DASH.brand);
      dashRender();
      return;
    }
    const o = e.target.closest('[data-dash-open]');
    if (o && !o.disabled) dashOpen(o.dataset.dashOpen, o.dataset.dashLevel || '');
  });
  // ✨: aria-pressed = the choice; the title also says when the computer's reduced-motion setting keeps it still.
  const btn = $('fxBtn');
  const sync = () => {
    if (!btn) return;
    const on = dashFxSaved();
    btn.setAttribute('aria-pressed', String(on));
    btn.title = 'Dashboard animation: ' + (on ? (dashReduce() ? 'on, but your computer asks for reduced motion' : 'on') : 'off');
  };
  if (btn) btn.addEventListener('click', () => {
    dashSet(DASH_LS.fx, dashFxSaved() ? '0' : '1');
    sync();
    if (dashShown()) dashRender();
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
  DASH_READY = true;
})();
