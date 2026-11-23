/* ================= SALES · SALES DASHBOARD CHARTS: the KPI sparklines, the daily chart, the monthly chart, "Show tables" (23 Nov 2026) =================
 * Screens: the Sales Dashboard (pane paneSales) — a 30-day sparkline in each KPI card (under the number), DAILY SALES at full width
 *          (#sdChartDaily: Sales / Units / Ad spend · 30 days / 90 days / This year), MONTHLY — this year vs last year at full width
 *          (#sdChartMonthly) and the Period / Monthly Comparison tables folded under "Show tables ▾" (remembered: localStorage).
 * Does: DRAWS ONLY — no number is worked out here that the Sales Dashboard does not already show or sum the same way:
 *   sales / units per day   sdDays(channel) — the Sales Dashboard's own days (the nightly history, Seller Central's totals laid
 *                           over where published) for the channel on view (All = Ridhi + CPC + Shopify, as sdSum adds them)
 *   ad spend per day        Seller Central's ad totals (matchAds: Sponsored Products + Brands + Display) on the days Amazon has
 *                           published them — the Overview's own definition (docs/sales-metrics.md "Ad spend"); Ridhi + CPC only
 *   last year               the same WEEKDAY a year back (364 days), so a Saturday is set beside a Saturday — US Pacific days
 *   monthly                 sdSum per month, exactly as the Monthly Comparison table and the old chart
 *   ANNOTATIONS (at most 3, never overlapping, never made up): deals people typed in the Deal Calendar (D_PLAN: its type and
 *   parent) whose days fall in view, labelled at their highest day; and the biggest mover of the last finished week from
 *   "This week in plain English" (sales/sales-insight.js), at that week's highest day (Sales only).
 * Look: the Sales Dashboard's own cards; one y-axis ($k or a count), muted gridlines, no vertical gridlines, 2 px lines, a smooth
 *   (monotone) blue line + light area for this year, a dashed grey line for last year, a crosshair and ONE tooltip. Lines draw in
 *   with GSAP when the page has it (else CSS); nothing moves with ✨ off or reduced motion. Light + dark + phone.
 * Main functions: sdcRender (called from renderSales), sdcSparks, sdcDaily, sdcMonthly, sdcTablesInit. Every name starts with sdc / SDC. */

const SDC = { metric: 'sales', range: '90', w: 0, drawn: {}, ro: null, roT: 0, last: null };
const SDC_TABLES_LS = 'sdTablesOpen';
const SDC_H = 320;                                   // the daily chart's height
const SDC_MH = 260;                                  // the monthly chart's height
const SDC_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SDC_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SDC_NF = new Intl.NumberFormat('en-US');
const sdcEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const sdcDay = iso => `${SDC_MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const sdcDow = iso => SDC_DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
// No motion with reduced motion or ✨ off; GSAP when the page already has it; else CSS.
function sdcMotion() {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'none';
    if (typeof dashFxOn === 'function' && !dashFxOn()) return 'none';
    return typeof window !== 'undefined' && window.gsap ? 'gsap' : 'css';
  } catch (e) { return 'none'; }
}

/* ----- the numbers per day (read, never worked out anew) ----- */
const sdcChans = () => (SD_CH === 'ALL' ? ['SP', 'CPC', 'SHOP'] : [SD_CH]);
/** day → value for the channel on view: sales (0) or units (1) from sdDays; null for a day nobody holds. */
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
// A round top for the y-axis and its 4 steps.
function sdcNice(max) {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
/** A smooth line that never overshoots (monotone cubic, Fritsch–Carlson) through [x, y] points; gaps (null) break it. */
function sdcPath(pts) {
  let d = '';
  const runs = [];
  let run = [];
  pts.forEach(p => { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } });
  if (run.length) runs.push(run);
  runs.forEach(r => {
    if (r.length === 1) { d += `M${r[0][0]},${r[0][1]}h0.01`; return; }
    const n = r.length, dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = r[i + 1][0] - r[i][0]; dy[i] = r[i + 1][1] - r[i][1]; m[i] = dx[i] ? dy[i] / dx[i] : 0; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (!m[i]) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    d += `M${r[0][0].toFixed(1)},${r[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(r[i][0] + h).toFixed(1)},${(r[i][1] + t[i] * h).toFixed(1)} ${(r[i + 1][0] - h).toFixed(1)},${(r[i + 1][1] - t[i + 1] * h).toFixed(1)} ${r[i + 1][0].toFixed(1)},${r[i + 1][1].toFixed(1)}`;
    }
  });
  return d;
}

/* ----- the KPI sparklines: the last 30 days of sales, each card's own days drawn strong ----- */
function sdcSparks(today) {
  if (typeof document === 'undefined') return;
  const from = sdShift(today, -29), yest = sdShift(today, -1), month = today.slice(0, 8) + '01';
  const val = sdcValueOf('sales');
  const days = Array.from({ length: 30 }, (_, i) => sdShift(from, i));
  const vals = days.map(d => val(d) || 0);
  const max = Math.max(1, ...vals);
  const W = 120, H = 28;
  const xy = i => [i / 29 * W, H - 2 - vals[i] / max * (H - 4)];
  const all = sdcPath(days.map((d, i) => xy(i)));
  const own = { today: [today, today], yest: [yest, yest], seven: [sdShift(yest, -6), yest], mtd: [month, today], proj: [month, yest], ytd: [from, today] };
  document.querySelectorAll('#paneSales [data-spark]').forEach(el => {
    const [a, b] = own[el.dataset.spark] || [from, today];
    const pts = days.map((d, i) => (d >= a && d <= b ? xy(i) : null));
    const dot = a === b ? pts.find(Boolean) : null;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="sdc-sp-all" d="${all}"/>`
      + `<path class="sdc-sp-own" d="${sdcPath(pts)}"/>${dot ? `<circle class="sdc-sp-dot" cx="${dot[0]}" cy="${dot[1]}" r="2.4"/>` : ''}</svg>`;
    el.title = 'Daily sales, the last 30 days';
  });
}

/* ----- the annotations: real deals and the week's biggest mover — at most 3, never overlapping ----- */
function sdcNotes(days, vals, xOf, yOf, metric) {
  const out = [];
  const inView = d => d >= days[0] && d <= days[days.length - 1];
  const peakIn = (a, b) => {
    let best = -1;
    days.forEach((d, i) => { if (d >= a && d <= b && vals[i] != null && (best < 0 || vals[i] > vals[best])) best = i; });
    return best;
  };
  // the biggest mover of the last finished week (This week in plain English), Sales only
  try {
    const brand = SD_CH === 'SP' || SD_CH === 'CPC' ? SD_CH : SD_CH === 'ALL' ? 'ALL' : null;
    const res = metric === 'sales' && brand && typeof viFor === 'function' && typeof VI !== 'undefined' && VI.data ? viFor(brand) : null;
    if (res && res.ok && res.movers.length) {
      const m = res.movers[0];
      const i = peakIn(res.wk.L, sdShift(res.wk.L, 6));
      if (i >= 0) out.push({ i, text: `${m.name.slice(0, 28)}${m.name.length > 28 ? '…' : ''} ${viMoney(m.d, true)}`, tip: `Last week's biggest mover: ${m.name} ${viMoney(m.d, true)} — ${m.driver.t}`, k: 'mover' });
    }
  } catch (e) { /* no mover note */ }
  // deals typed in the Deal Calendar for the brand on view (a recommendation Amazon only suggested is never drawn)
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
  } catch (e) { /* no deal notes */ }
  // the mover first, then the deals on the highest days; a label that would touch one already placed is left out
  const deals = out.filter(n => n.k === 'deal').sort((a, b) => (b.v || 0) - (a.v || 0));
  const picked = [];
  out.filter(n => n.k === 'mover').concat(deals).forEach(n => {
    if (picked.length >= 3) return;
    const w = n.text.length * 6.4 + 14, x = xOf(n.i);
    // a label that would touch one already placed goes one row higher; when both rows are taken there, it is left out
    const row = [0, 1].find(r => !picked.some(p => p.row === r && Math.abs(p.x - x) < (p.w + w) / 2 + 6));
    if (row == null) return;
    picked.push(Object.assign(n, { x, y: yOf(vals[n.i]), w, row }));
  });
  return picked;
}

/* ----- DAILY SALES: full width ----- */
function sdcDaily(today) {
  const el = typeof document !== 'undefined' && document.getElementById('sdChartDaily');
  if (!el) return;
  const metric = SD_CH === 'SHOP' && SDC.metric === 'ads' ? 'sales' : SDC.metric;
  const from = SDC.range === 'ytd' ? today.slice(0, 4) + '-01-01' : sdShift(today, -(Number(SDC.range) - 1));
  const n = Math.round((Date.parse(today) - Date.parse(from)) / 864e5) + 1;
  const days = Array.from({ length: n }, (_, i) => sdShift(from, i));
  const val = sdcValueOf(metric);
  const ty = days.map(val), ly = days.map(d => val(sdShift(d, -364)));
  const note = document.getElementById('sdcNote');
  if (!ty.some(v => v != null)) {
    el.innerHTML = `<div class="ui-empty">${metric === 'ads' ? 'No ad spend from Seller Central for these days yet.' : 'No data yet.'}</div>`;
    if (note) note.textContent = '';
    return;
  }
  // --- geometry (the real width, so text stays crisp) ---
  const W = Math.max(320, Math.round(el.clientWidth || SDC.w || 960));
  SDC.w = W;
  const phone = W < 560;
  const padL = phone ? 40 : 52, padR = 14, padT = 34, padB = 28;
  const iw = W - padL - padR, ih = SDC_H - padT - padB;
  const top = sdcNice(Math.max(...ty.concat(ly).filter(v => v != null), 0) * 1.05);
  const xOf = i => padL + (n === 1 ? iw / 2 : i / (n - 1) * iw);
  const yOf = v => padT + ih - (v || 0) / top * ih;
  // --- the grid (horizontal only), the axis, the date labels ---
  let svg = '';
  for (let k = 0; k <= 4; k++) {
    const v = top * k / 4, y = yOf(v);
    svg += `<line class="sdc-grid" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`
      + `<text class="sdc-ax" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${sdcFmt(metric, v, true)}</text>`;
  }
  const labels = phone ? 4 : SDC.range === 'ytd' ? 12 : 8;
  const step = Math.max(1, Math.ceil(n / labels));
  for (let i = 0; i < n; i += step) svg += `<text class="sdc-ax" x="${xOf(i).toFixed(1)}" y="${SDC_H - 8}" text-anchor="middle">${sdcDay(days[i])}</text>`;
  // --- last year (dashed), this year (area + line) ---
  const lyPath = sdcPath(ly.map((v, i) => (v == null ? null : [xOf(i), yOf(v)])));
  // today is still running: its piece of the line is dashed and kept out of the area, so a part day never reads as a fall
  const partial = days[n - 1] === today && n > 1 && ty[n - 1] != null && ty[n - 2] != null;
  const tyPts = ty.map((v, i) => (v == null || (partial && i === n - 1) ? null : [xOf(i), yOf(v)]));
  const tyPath = sdcPath(tyPts);
  const todayPath = partial ? `M${xOf(n - 2).toFixed(1)},${yOf(ty[n - 2]).toFixed(1)}L${xOf(n - 1).toFixed(1)},${yOf(ty[n - 1]).toFixed(1)}` : '';
  const firstI = ty.findIndex(v => v != null), lastI = (partial ? n - 2 : ty.length - 1 - [...ty].reverse().findIndex(v => v != null));
  const area = tyPath && !ty.slice(firstI, lastI + 1).includes(null)
    ? `${tyPath}L${xOf(lastI).toFixed(1)},${padT + ih}L${xOf(firstI).toFixed(1)},${padT + ih}Z` : '';
  svg += `<path class="sdc-ly" d="${lyPath}"/>` + (area ? `<path class="sdc-area" d="${area}"/>` : '') + `<path class="sdc-ty" d="${tyPath}" pathLength="1"/>`
    + (todayPath ? `<path class="sdc-today" d="${todayPath}"><title>Today so far — the day is still running</title></path>` : '');
  // --- the annotations ---
  const notes = sdcNotes(days, ty, xOf, yOf, metric);
  notes.forEach(a => {
    const lx = Math.min(Math.max(a.x, padL + a.w / 2), W - padR - a.w / 2), ly2 = Math.max(14 + (a.row ? 0 : 22), a.y - 18 - a.row * 22);
    svg += `<g class="sdc-note-g is-${a.k}"><title>${sdcEsc(a.tip)}</title><line class="sdc-note-l" x1="${a.x.toFixed(1)}" x2="${a.x.toFixed(1)}" y1="${(ly2 + 5).toFixed(1)}" y2="${(a.y - 4).toFixed(1)}"/>`
      + `<circle class="sdc-note-dot" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="3.5"/>`
      + `<rect class="sdc-note-bg" x="${(lx - a.w / 2).toFixed(1)}" y="${(ly2 - 12).toFixed(1)}" width="${a.w.toFixed(1)}" height="17" rx="8.5"/>`
      + `<text class="sdc-note-t" x="${lx.toFixed(1)}" y="${(ly2).toFixed(1)}" text-anchor="middle">${sdcEsc(a.text)}</text></g>`;
  });
  // --- the crosshair (moved by the pointer) ---
  svg += `<g class="sdc-x" hidden><line class="sdc-x-l" y1="${padT}" y2="${padT + ih}"/><circle class="sdc-x-ly" r="3.5"/><circle class="sdc-x-ty" r="4"/></g>`
    + `<rect class="sdc-hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}"/>`;
  const label = metric === 'units' ? 'Units' : metric === 'ads' ? 'Ad spend' : 'Sales';
  el.innerHTML = `<svg class="sdc-svg" viewBox="0 0 ${W} ${SDC_H}" width="${W}" height="${SDC_H}" role="img" aria-label="${sdcEsc(label)} per day, this year and the same weekday last year">${svg}</svg>`
    + '<div class="sdc-tip" hidden></div>';
  if (note) note.textContent = metric === 'ads'
    ? 'Ad spend: Seller Central\'s ad totals (Sponsored Products + Brands + Display), on the days Amazon has published them. Last year: the same weekday a year back.'
    : 'US Pacific days; today is still running. Last year: the same weekday a year back (364 days), so a Saturday sits beside a Saturday.';
  // --- the tooltip ---
  const svgEl = el.querySelector('svg'), cross = svgEl.querySelector('.sdc-x'), tip = el.querySelector('.sdc-tip');
  const move = ev => {
    const r = svgEl.getBoundingClientRect();
    const x = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.round((x - padL) / iw * (n - 1))));
    const a = ty[i], b = ly[i];
    cross.hidden = false;
    cross.querySelector('.sdc-x-l').setAttribute('x1', xOf(i));
    cross.querySelector('.sdc-x-l').setAttribute('x2', xOf(i));
    const cT = cross.querySelector('.sdc-x-ty'), cL = cross.querySelector('.sdc-x-ly');
    cT.setAttribute('cx', xOf(i)); cT.setAttribute('cy', yOf(a)); cT.style.display = a == null ? 'none' : '';
    cL.setAttribute('cx', xOf(i)); cL.setAttribute('cy', yOf(b)); cL.style.display = b == null ? 'none' : '';
    const pct = a != null && b ? (a - b) / b * 100 : null;
    const lyDay = sdShift(days[i], -364);
    tip.innerHTML = `<b>${sdcDow(days[i])}, ${sdcDay(days[i])}${days[i] === today ? ' · today so far' : ''}</b>`
      + `<span class="sdc-tk is-ty">This year <em>${sdcFmt(metric, a)}</em></span>`
      + `<span class="sdc-tk is-ly">Last year · ${sdcDow(lyDay)}, ${sdcDay(lyDay)} ${lyDay.slice(0, 4)} <em>${sdcFmt(metric, b)}</em></span>`
      + `<span class="sdc-tk">vs last year <em class="${pct == null ? '' : pct < 0 ? 'is-dn' : 'is-up'}">${pct == null ? '—' : (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct).toFixed(1) + '%'}</em></span>`;
    tip.hidden = false;
    const px = xOf(i) / W * r.width, tw = tip.offsetWidth || 200;
    let left = px + 14;                              // beside the crosshair; on its left near the right edge
    if (left + tw > r.width - 4) left = px - tw - 14;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(4, yOf(Math.max(a || 0, b || 0)) / SDC_H * r.height - 10) + 'px';
  };
  const hit = svgEl.querySelector('.sdc-hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.hidden = true; tip.hidden = true; });
  // --- draw in: once per channel / measure / range ---
  const key = [SD_CH, metric, SDC.range].join('|');
  if (!SDC.drawn[key]) { SDC.drawn[key] = true; sdcDrawIn(el); }
}
function sdcDrawIn(el) {
  const how = sdcMotion();
  if (how === 'none') return;
  const line = el.querySelector('.sdc-ty'), rest = el.querySelectorAll('.sdc-area, .sdc-ly, .sdc-note-g, .sdc-mbar');
  if (how === 'gsap') {
    if (line) window.gsap.fromTo(line, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' });
    if (rest.length) window.gsap.from(rest, { opacity: 0, duration: 0.5, delay: 0.25, stagger: 0.02, clearProps: 'opacity' });
  } else { el.classList.remove('sdc-in'); void el.offsetWidth; el.classList.add('sdc-in'); }
}

/* ----- MONTHLY — this year vs last year: the same sums as the Monthly Comparison table ----- */
function sdcMonthly(yr, lyr) {
  const el = typeof document !== 'undefined' && document.getElementById('sdChartMonthly');
  if (!el) return;
  const ty = [], ly = [];
  for (let m = 0; m < 12; m++) {
    const mm = String(m + 1).padStart(2, '0');
    const last = new Date(Date.UTC(Number(yr), m + 1, 0)).toISOString().slice(0, 10);
    ty.push(sdSum(`${yr}-${mm}-01`, last)[0]);
    ly.push(sdSum(`${lyr}-${mm}-01`, `${lyr}-${mm}-31`)[0]);
  }
  const W = Math.max(320, Math.round(el.clientWidth || SDC.w || 960));
  const phone = W < 560;
  const padL = phone ? 40 : 52, padR = 14, padT = 14, padB = 26;
  const iw = W - padL - padR, ih = SDC_MH - padT - padB;
  const top = sdcNice(Math.max(1, ...ty, ...ly) * 1.05);
  const yOf = v => padT + ih - v / top * ih;
  const slot = iw / 12, bw = Math.max(4, Math.min(22, slot * 0.32));
  // a bar with only its top corners rounded
  const bar = (x, v, cls) => {
    const y = yOf(v), h = padT + ih - y;
    if (h <= 0) return '';
    const r = Math.min(4, bw / 2, h);
    return `<path class="sdc-mbar ${cls}" d="M${x.toFixed(1)},${(padT + ih).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}`
      + `H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${y.toFixed(1)} ${(x + bw).toFixed(1)},${(y + r).toFixed(1)}V${(padT + ih).toFixed(1)}Z"/>`;
  };
  let svg = '';
  for (let k = 0; k <= 4; k++) {
    const v = top * k / 4, y = yOf(v);
    svg += `<line class="sdc-grid" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`
      + `<text class="sdc-ax" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${sdcFmt('sales', v, true)}</text>`;
  }
  for (let m = 0; m < 12; m++) {
    const cx = padL + slot * m + slot / 2;
    svg += bar(cx - bw - 1.5, ty[m], 'is-ty') + bar(cx + 1.5, ly[m], 'is-ly')
      + `<text class="sdc-ax" x="${cx.toFixed(1)}" y="${SDC_MH - 8}" text-anchor="middle">${phone ? SDC_MON[m].charAt(0) : SDC_MON[m]}</text>`
      + `<rect class="sdc-mhit" data-m="${m}" x="${(padL + slot * m).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${ih}"/>`;
  }
  el.innerHTML = `<svg class="sdc-svg" viewBox="0 0 ${W} ${SDC_MH}" width="${W}" height="${SDC_MH}" role="img" aria-label="Sales per month, ${yr} against ${lyr}">${svg}</svg><div class="sdc-tip" hidden></div>`;
  const svgEl = el.querySelector('svg'), tip = el.querySelector('.sdc-tip');
  svgEl.querySelectorAll('.sdc-mhit').forEach(h => {
    const show = () => {
      const m = Number(h.dataset.m), a = ty[m], b = ly[m];
      const pct = b ? (a - b) / b * 100 : null;
      svgEl.querySelectorAll('.sdc-mhit').forEach(x => x.classList.toggle('is-on', x === h));
      tip.innerHTML = `<b>${SDC_MON[m]}</b><span class="sdc-tk is-ty">${yr} <em>${sdMoney(a)}</em></span><span class="sdc-tk is-ly">${lyr} <em>${sdMoney(b)}</em></span>`
        + `<span class="sdc-tk">change <em class="${pct == null ? '' : pct < 0 ? 'is-dn' : 'is-up'}">${pct == null ? '—' : (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct).toFixed(1) + '%'}</em></span>`;
      tip.hidden = false;
      const r = svgEl.getBoundingClientRect(), px = (padL + slot * (m + 0.5)) / W * r.width, tw = tip.offsetWidth || 160;
      tip.style.left = Math.min(Math.max(px - tw / 2, 4), r.width - tw - 4) + 'px';
      tip.style.top = Math.max(4, yOf(Math.max(a, b)) / SDC_MH * r.height - 70) + 'px';
    };
    h.addEventListener('pointerenter', show);
    h.addEventListener('pointerdown', show);
    h.addEventListener('pointerleave', () => { tip.hidden = true; h.classList.remove('is-on'); });
  });
  const key = ['m', SD_CH, yr].join('|');
  if (!SDC.drawn[key]) {
    SDC.drawn[key] = true;
    const how = sdcMotion();
    if (how === 'gsap') window.gsap.from(svgEl.querySelectorAll('.sdc-mbar'), { scaleY: 0, transformOrigin: '50% 100%', duration: 0.5, stagger: 0.015, ease: 'power2.out', clearProps: 'transform' });
    else if (how === 'css') { el.classList.remove('sdc-in'); void el.offsetWidth; el.classList.add('sdc-in'); }
  }
}

/* ----- the controls, the tables' fold, a redraw on resize ----- */
function sdcTablesSet(open) {
  const box = document.getElementById('sdTables'), btn = document.getElementById('sdTablesBtn');
  if (!box || !btn) return;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide tables ▴' : 'Show tables ▾';
}
function sdcTablesInit() {
  let open = false;
  try { open = localStorage.getItem(SDC_TABLES_LS) === '1'; } catch (e) { open = false; }
  sdcTablesSet(open);
}
function sdcSeg(id, attr, val) {
  const g = document.getElementById(id);
  if (g) g.querySelectorAll('button').forEach(b => { const on = b.dataset[attr] === val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}
/** Everything this file draws, for the channel on view (renderSales calls it after its own numbers). */
function sdcRender(today, yr, lyr) {
  SDC.last = { today, yr, lyr };
  if (!SDC.tables) { SDC.tables = true; sdcTablesInit(); }
  const ads = document.querySelector('#sdcMetric [data-m="ads"]');
  if (ads) { ads.disabled = SD_CH === 'SHOP'; ads.title = SD_CH === 'SHOP' ? 'Shopify has no ad spend in Sellora' : 'Seller Central\'s ad totals per day'; }
  sdcSeg('sdcMetric', 'm', SD_CH === 'SHOP' && SDC.metric === 'ads' ? 'sales' : SDC.metric);
  sdcSeg('sdcRange', 'r', SDC.range);
  sdcSparks(today);
  sdcDaily(today);
  sdcMonthly(yr, lyr);
  if (!SDC.ro && typeof ResizeObserver === 'function') {
    const box = document.getElementById('sdChartDaily');
    if (box) {
      SDC.ro = new ResizeObserver(() => {
        clearTimeout(SDC.roT);
        SDC.roT = setTimeout(() => {
          const w = Math.round(box.clientWidth);
          if (w && Math.abs(w - SDC.w) > 8 && SDC.last) { sdcDaily(SDC.last.today); sdcMonthly(SDC.last.yr, SDC.last.lyr); }
        }, 150);
      });
      SDC.ro.observe(box);
    }
  }
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('#sdcMetric [data-m], #sdcRange [data-r], #sdTablesBtn') : null;
    if (!t || t.disabled) return;
    if (t.id === 'sdTablesBtn') {
      const open = document.getElementById('sdTables').hidden;
      try { localStorage.setItem(SDC_TABLES_LS, open ? '1' : '0'); } catch (x) { /* this visit only */ }
      return sdcTablesSet(open);
    }
    if (t.dataset.m) SDC.metric = t.dataset.m;
    if (t.dataset.r) SDC.range = t.dataset.r;
    if (SDC.last) sdcRender(SDC.last.today, SDC.last.yr, SDC.last.lyr);
  });
}
