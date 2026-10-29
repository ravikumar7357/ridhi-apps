/* ================= PPC & ORGANIC · NEW (test) =================
 * The redesigned PPC & Organic, BESIDE the old tab rather than over it (Ravi, 2026-10-29): one toolbar
 * row, date chips above the products, columns built as N × X days, a picture on every row.
 *
 * READS ONLY WHAT THE OLD TAB READS, and keeps no store of its own. WEEKLY and WDAY are filled by the
 * same loadWeekly + wNightly the old tab uses — same ten-minute throttle — so the two tabs can never
 * disagree, and opening this one costs nothing the old one does not.
 *
 * Who sees it: everyone who holds PPC & Organic (TAB_INHERIT in nav.js). The Firestore rules gate
 * these documents on `weekly`, so granting this tab on its own would only ever open an empty screen.
 *
 * Which store answers a date range — decided by the dates, exactly as wRangePlan decides it:
 *   · on or after WDAY.from          → the per-day store (sales, units, ad spend, ad sales)
 *   · whole Sunday→Saturday weeks     → the weekly store
 *   · anything else                   → nothing, and the screen says why instead of guessing
 */
const PX_KEY = 'pxState';
const PX_PAGE = 100;
let PX = {
  mode: 'range', level: 'parent', brand: 'ALL', metric: 'rev', dkey: 'd7', lo: '', hi: '',
  pc: { n: 4, len: 7, end: '', preset: null }, hide: [], q: '', chip: 'all', sk: 'rev', sd: -1,
  open: new Set(), kidN: {}, pop: null, draft: null, show: PX_PAGE, msg: '', loading: false, anim: false,
};
/* An opened parent shows its biggest sizes first and only this many — a 246-size tablecloth opened in
 * full buries every other product under it. Per parent; 0 means all. */
const PX_KID_STEPS = [10, 20, 50, 100, 0];
const pxKidLimit = key => (PX.kidN[key] != null ? PX.kidN[key] : 10);
// Only the choices are remembered, never dates: a remembered "12–26 Oct" would be stale by Monday.
try {
  const s = JSON.parse(localStorage.getItem(PX_KEY) || '{}');
  ['mode', 'level', 'metric', 'dkey', 'hide'].forEach(k => { if (s[k] != null) PX[k] = s[k]; });
  if (s.pc) PX.pc = { n: s.pc.n || 4, len: s.pc.len || 7, end: '', preset: s.pc.preset || null };
  if (PX.dkey === 'custom') PX.dkey = 'd7';
} catch (e) { /* storage off — defaults */ }
function pxSave() {
  try {
    localStorage.setItem(PX_KEY, JSON.stringify({ mode: PX.mode, level: PX.level, metric: PX.metric,
      dkey: PX.dkey, hide: PX.hide, pc: { n: PX.pc.n, len: PX.pc.len, preset: PX.pc.preset } }));
  } catch (e) { /* fine */ }
}

/* ---------- formatting ---------- */
const pxEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const pxMoney = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
const pxPct = v => (v == null ? '—' : v.toFixed(1) + '%');
const pxSgn = v => (v == null ? '—' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');
const pxShort = v => (v == null ? '—' : v >= 10000 ? '$' + (v / 1000).toFixed(0) + 'k' : v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v));
const pxLen = (lo, hi) => Math.round((Date.parse(hi) - Date.parse(lo)) / 86400000) + 1;
function pxDM(iso) { const d = wDate(iso); return d.getUTCDate() + ' ' + W_MON[d.getUTCMonth()]; }
function pxMD(iso) { const d = wDate(iso); return W_MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
function pxFmtRange(lo, hi) {
  if (!lo || !hi) return '—';
  const y = ' ' + hi.slice(0, 4);
  if (lo === hi) return pxDM(lo) + y;
  return lo.slice(0, 7) === hi.slice(0, 7) ? wDate(lo).getUTCDate() + '–' + pxDM(hi) + y : pxDM(lo) + ' – ' + pxDM(hi) + y;
}
function pxColLabel(lo, hi) {
  if (lo === hi) return pxMD(lo);
  return lo.slice(0, 7) === hi.slice(0, 7) ? pxMD(lo) + '–' + wDate(hi).getUTCDate() : pxMD(lo) + ' – ' + pxMD(hi);
}

/* ---------- dates ---------- */
// PT, the marketplace's day — sdToday() is what every other date on this app is measured against.
const PX_DATES = {
  today:  ['Today', t => [t, t]],
  yest:   ['Yesterday', t => [sdShift(t, -1), sdShift(t, -1)]],
  d7:     ['7 days', t => [sdShift(t, -7), sdShift(t, -1)]],
  d14:    ['14 days', t => [sdShift(t, -14), sdShift(t, -1)]],
  d30:    ['30 days', t => [sdShift(t, -30), sdShift(t, -1)]],
  month:  ['This month', t => [t.slice(0, 8) + '01', t]],
  lmonth: ['Last month', t => { const e = sdShift(t.slice(0, 8) + '01', -1); return [e.slice(0, 8) + '01', e]; }],
};
function pxRange() { return PX.dkey === 'custom' ? [PX.lo, PX.hi] : PX_DATES[PX.dkey][1](sdToday()); }

// Column set-ups. A month splits into weeks of that month (1–7, 8–14 …); the rest are N × X days.
const PX_COLP = [['d7x1', 'Last 7 days, day by day', 7, 1], ['month', 'This month'], ['lmonth', 'Last month'], ['m3', 'Last 3 months', 3, 30]];
function pxCols(pc) {
  const t = sdToday();
  if (pc.preset === 'month' || pc.preset === 'lmonth') {
    const [lo, hi] = PX_DATES[pc.preset][1](t), out = [];
    for (let a = lo; a <= hi; a = sdShift(a, 7)) { const b = sdShift(a, 6); out.push([a, b < hi ? b : hi]); }
    return out;
  }
  const end = pc.end || sdShift(t, -1), out = [];
  for (let k = pc.n - 1; k >= 0; k--) { const hi = sdShift(end, -k * pc.len); out.push([sdShift(hi, -(pc.len - 1)), hi]); }
  return out;
}
function pxColsDesc(pc) {
  const p = PX_COLP.find(x => x[0] === pc.preset);
  if (pc.preset === 'month' || pc.preset === 'lmonth') return p[1] + ' · week by week';
  return pc.n + ' columns × ' + pc.len + (pc.len === 1 ? ' day' : ' days');
}

/* ---------- which store answers a range ---------- */
function pxPlan(lo, hi) {
  if (!lo || !hi || lo > hi) return { src: 'none', lo, hi, id: 'x' };
  if (WDAY.from && lo >= WDAY.from) return { src: 'day', keys: wDaysBetween(lo, hi), lo, hi, id: 'd' + lo + hi };
  const after = sdShift(hi, 1);
  if (wKeyOfDate(lo) === lo && wKeyOfDate(after) === after) {
    const keys = []; for (let w = lo; w <= hi; w = sdShift(w, 7)) keys.push(w);
    return { src: 'week', keys, lo, hi, id: 'w' + lo + hi };
  }
  return { src: 'none', lo, hi, id: 'n' + lo + hi };
}
const pxPrevPlan = p => { const L = pxLen(p.lo, p.hi); return pxPlan(sdShift(p.lo, -L), sdShift(p.lo, -1)); };

let PX_MEMO = new Map();
function pxSumAsin(a, p) {
  const k = a + '|' + p.id;
  if (PX_MEMO.has(k)) return PX_MEMO.get(k);
  const o = { u: 0, rev: 0, spend: null, adSales: null, has: false };
  if (p.src !== 'none') {
    const store = p.src === 'day' ? (WDAY.rows[a] || {}).days : (WEEKLY.rows[a] || {}).weeks;
    if (store) p.keys.forEach(key => {
      const c = store[key]; if (!c) return;
      o.has = true; o.u += c.u || 0; o.rev += c.rev || 0;
      if (c.spend != null) o.spend = (o.spend || 0) + c.spend;
      if (c.adSales != null) o.adSales = (o.adSales || 0) + c.adSales;
    });
  }
  PX_MEMO.set(k, o);
  return o;
}
// Summed field by field, ratios worked out afterwards from the totals — never an average of ratios.
function pxDerive(o) {
  if (!o.has) return Object.assign(o, { os: null, op: null, acos: null, tacos: null });
  o.os = o.adSales == null ? null : Math.max(0, o.rev - o.adSales);
  o.op = o.os == null || !o.rev ? null : o.os / o.rev * 100;
  o.acos = o.spend == null || !o.adSales ? null : o.spend / o.adSales * 100;
  o.tacos = o.spend == null || !o.rev ? null : o.spend / o.rev * 100;
  return o;
}
function pxStats(asins, p, withPrev) {
  const o = { u: 0, rev: 0, spend: null, adSales: null, has: false };
  asins.forEach(a => {
    const s = pxSumAsin(a, p); if (!s.has) return;
    o.has = true; o.u += s.u; o.rev += s.rev;
    if (s.spend != null) o.spend = (o.spend || 0) + s.spend;
    if (s.adSales != null) o.adSales = (o.adSales || 0) + s.adSales;
  });
  pxDerive(o);
  if (withPrev) {
    const q = pxStats(asins, pxPrevPlan(p), false);
    o.vp = o.has && q.has && q.rev ? (o.rev - q.rev) / q.rev * 100 : null;
  }
  return o;
}

/* ---------- products: parents, children, names, SKUs, pictures ---------- */
let PX_LOOK = null;          // asin → { brand, sku } from the Listing Health snapshot
function pxLookup() {
  if (PX_LOOK) return PX_LOOK;
  PX_LOOK = {};
  ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
    const a = String(r.asin || '').trim().toUpperCase();
    if (a && !PX_LOOK[a]) PX_LOOK[a] = { brand: b, sku: r.sku || '' };
  }));
  return PX_LOOK;
}
/* Pictures come from Image Manager's snapshot, which the rules open only to Image Manager and Listing
 * Errors. Anyone else gets a lettered tile — never an error, since a missing picture loses nothing. */
let PX_IMG = null;
async function pxImages() {
  if (PX_IMG) return;
  PX_IMG = {};
  if (!(ME.admin || ME.tabs.includes('img') || ME.tabs.includes('lerr'))) return;
  for (const b of adBrands()) {
    try {
      if (!(b in IML)) await imListLoad(b);
      (IML[b]?.items || []).forEach(x => {
        const a = String(x.asin || '').trim().toUpperCase(); if (!a || PX_IMG[a]) return;
        PX_IMG[a] = { u: (x.live || {}).MAIN || (x.img || {}).MAIN || '', c: x.c || '', z: x.z || '' };
      });
    } catch (e) { /* no pictures for that brand — tiles instead */ }
  }
  if (TAB_NOW === 'ppcn') pxRender();
}
function pxPic(asins, label, small) {
  const hit = asins.map(a => PX_IMG && PX_IMG[a]).find(x => x && x.u);
  const cls = 'px-pic' + (small ? ' px-sm' : '');
  if (hit) return `<span class="${cls}"><img src="${pxEsc(imThumb(hit.u))}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="${cls} px-noimg" aria-hidden="true">${pxEsc((label || '?').replace(/^~\s*/, '').charAt(0).toUpperCase())}</span>`;
}
function pxSize(a) {
  const x = PX_IMG && PX_IMG[a];
  return x ? [x.c, x.z].filter(Boolean).join(' · ') : '';
}

function pxEntities() {
  const look = pxLookup(), allowed = adBrands();
  const brandOf = a => (WEEKLY.rows[a] && WEEKLY.rows[a].brand) || (look[a] && look[a].brand) || '';
  const all = new Set([...Object.keys(WEEKLY.rows), ...Object.keys(WDAY.rows)]);
  const keep = [];
  all.forEach(a => {
    const b = brandOf(a);
    if (!allowed.includes(b) || (PX.brand !== 'ALL' && b !== PX.brand)) return;
    keep.push([a, b]);
  });
  if (PX.level === 'child') {
    return keep.map(([a, b]) => ({ key: a, brand: b, asins: [a], title: wTitle(a) || '', sku: (look[a] || {}).sku || '',
      size: pxSize(a), parent: wParentOf(a) }));
  }
  const g = {};
  keep.forEach(([a, b]) => {
    const p = wParentOf(a);
    const o = g[p] || (g[p] = { key: p, brand: b, asins: [], title: '' });
    o.asins.push(a);
    if (!o.title) {
      const own = PNAME[b]?.[p]?.v || HEALTH[b]?.parentNames?.[p] || '';
      o.title = own || (wTitle(a) ? '~ ' + wTitle(a) : '');
    }
  });
  return Object.values(g);
}

/* ---------- filters, columns, sort ---------- */
const PX_FILTERS = {
  all:  ['All', () => true],
  cut:  ['ACoS 55%+', o => o.acos != null && o.acos >= 55],
  tac:  ['TACoS 30%+', o => o.tacos != null && o.tacos >= 30],
  org:  ['Organic 70%+', o => o.op != null && o.op >= 70],
  fall: ['Falling 30%+', o => o.vp != null && o.vp <= -30],
  grow: ['Growing', o => o.vp != null && o.vp > 0],
};
const PX_RCOLS = [['u', 'Units'], ['rev', 'Sales'], ['spend', 'Ad spend'], ['adSales', 'Ad sales'], ['os', 'Organic sales'],
  ['op', 'Organic share'], ['acos', 'ACoS'], ['tacos', 'TACoS'], ['vp', 'vs prev']];
const PX_METRICS = { rev: 'Sales', u: 'Units', spend: 'Ad spend', op: 'Organic %', acos: 'ACoS', tacos: 'TACoS' };
const pxIsPct = m => m === 'op' || m === 'acos' || m === 'tacos';
const pxLowGood = m => m === 'acos' || m === 'tacos';
const pxFmtM = (m, v) => (v == null ? '—' : pxIsPct(m) ? v.toFixed(1) + '%' : m === 'u' ? Math.round(v).toLocaleString('en-US') : pxShort(v));
const pxShown = k => !PX.hide.includes(k);

/* ---------- render ---------- */
const PX_IC_RANGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const PX_IC_COLS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/></svg>';

function pxCtx() {
  // Everything one render needs, worked out once.
  const ents = pxEntities();
  const q = PX.q.trim().toLowerCase();
  const found = q ? ents.filter(e => (e.title + ' ' + e.key + ' ' + (e.sku || '') + ' ' + (e.size || '')).toLowerCase().includes(q)) : ents;
  let span, cols = null;
  if (PX.mode === 'cols') {
    cols = pxCols(PX.pc).map(([lo, hi]) => pxPlan(lo, hi));
    span = pxPlan(cols[0].lo, cols[cols.length - 1].hi);
    if (span.src === 'none') span = cols[cols.length - 1];     // filters fall back to the newest column
  } else {
    const [lo, hi] = pxRange();
    span = pxPlan(lo, hi);
  }
  found.forEach(e => { e.st = pxStats(e.asins, span, true); });
  return { ents, found, span, cols };
}
function pxVal(e, k, ctx) {
  if (k === 't') return e.title || e.key;
  if (k === 'sku') return e.sku || '';
  if (k.startsWith('c:')) return pxStats(e.asins, ctx.cols[+k.slice(2)])[PX.metric];
  if (k === 'chg') { const c = pxChange(e, ctx); return c ? c.v : null; }
  return e.st[k];
}
/* The last FINISHED column against the one before it. A column still running today is skipped, as
 * wWeekDone skips a running week on the old tab: two days set beside seven reads as a collapse. */
function pxChange(e, ctx) {
  const cs = ctx.cols || [], today = sdToday();
  let i = cs.length - 1; while (i >= 0 && cs[i].hi >= today) i--;
  if (i < 1) return null;
  const a = pxStats(e.asins, cs[i])[PX.metric], b = pxStats(e.asins, cs[i - 1])[PX.metric];
  if (a == null || b == null) return null;
  return pxIsPct(PX.metric) ? { v: a - b, pt: true } : b ? { v: (a - b) / b * 100 } : null;
}
function pxSorted(list, ctx) {
  return list.slice().sort((x, y) => {
    const a = pxVal(x, PX.sk, ctx), b = pxVal(y, PX.sk, ctx);
    if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1;
    const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
    return c * PX.sd;
  });
}

const pxTh = (label, k, cls, sub) => `<th class="px-th ${cls || ''}" tabindex="0" data-pxsort="${k}"${PX.sk === k ? ` data-dir="${PX.sd > 0 ? 'asc' : 'desc'}"` : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</th>`;
const pxAcos = v => (v == null ? '<span class="px-dim">—</span>' : v >= 55 ? `<span class="px-pill px-bad">${pxPct(v)}</span>` : v <= 30 ? `<span class="px-pill px-ok">${pxPct(v)}</span>` : pxPct(v));
const pxObar = v => (v == null ? '<span class="px-dim">—</span>' : `<span class="px-obar"><span>${pxPct(v)}</span><i style="--p:${Math.max(0, Math.min(100, v)).toFixed(0)}%"></i></span>`);
const pxTacC = v => (v == null ? 'px-dim' : v >= 30 ? 'px-neg' : v <= 15 ? 'px-pos' : '');

function pxProd(e, kid) {
  if (kid) {
    const label = pxSize(e.key) || e.title || e.key;
    return `<div class="px-prod">${pxPic([e.key], label, true)}<div><b>${pxEsc(label)}</b><small>${pxEsc(e.key)}</small></div></div>`;
  }
  if (PX.level === 'child') {
    return `<div class="px-prod">${pxPic([e.key], e.title)}<div><b>${pxEsc(e.title || e.key)}${e.size ? `<span class="px-var">${pxEsc(e.size)}</span>` : ''}</b>`
      + `<small>${pxEsc(e.key)}${e.parent && e.parent !== e.key ? ' · parent ' + pxEsc(e.parent) : ''}</small></div></div>`;
  }
  const n = e.asins.length;
  const tag = n > 1 ? `<button class="px-sizes" data-pxopen="${pxEsc(e.key)}" aria-expanded="${PX.open.has(e.key)}">${n} sizes <i>▸</i></button>` : '';
  return `<div class="px-prod">${pxPic([e.key].concat(e.asins), e.title)}<div><b>${pxEsc(e.title || e.key)}${tag}</b><small>${pxEsc(e.key)}</small></div></div>`;
}
function pxRangeCells(o, tot) {
  const c = {
    u: `<td>${o.has ? Math.round(o.u).toLocaleString('en-US') : '—'}</td>`,
    rev: `<td>${o.has ? (tot ? pxMoney(o.rev) : '<b>' + pxMoney(o.rev) + '</b>') : '<span class="px-dim">—</span>'}</td>`,
    spend: `<td>${pxMoney(o.spend)}</td>`,
    adSales: `<td class="px-dim">${pxMoney(o.adSales)}</td>`,
    os: `<td>${pxMoney(o.os)}</td>`,
    op: `<td>${pxObar(o.op)}</td>`,
    acos: `<td>${tot ? pxPct(o.acos) : pxAcos(o.acos)}</td>`,
    tacos: `<td class="${tot ? '' : pxTacC(o.tacos)}">${pxPct(o.tacos)}</td>`,
    vp: `<td class="${tot ? '' : o.vp == null ? 'px-dim' : o.vp < 0 ? 'px-neg' : 'px-pos'}">${pxSgn(o.vp)}</td>`,
  };
  return PX_RCOLS.filter(x => pxShown(x[0])).map(x => c[x[0]]).join('');
}
/** The children of an opened parent: biggest sellers in the shown dates first, cut to the chosen count. */
function pxKids(e, ctx) {
  const all = e.asins.map(a => ({ key: a, asins: [a], title: wTitle(a), st: pxStats([a], ctx.span, true) }))
    .sort((a, b) => (b.st.rev || 0) - (a.st.rev || 0));
  const n = pxKidLimit(e.key);
  return { kids: n ? all.slice(0, n) : all, total: all.length };
}
/** The "showing 10 of 246 sizes · 10 20 50 100 All" line under an opened parent. */
function pxKidBar(e, total) {
  if (total <= PX_KID_STEPS[0]) return '';
  const n = pxKidLimit(e.key), shown = n ? Math.min(n, total) : total;
  return `<tr class="px-kidbar"><td colspan="99"><div class="px-kidbar-in"><span>Showing <b>${shown}</b> of ${total} sizes, best sellers first</span>`
    + '<div class="px-seg px-segsm" role="group" aria-label="How many sizes">'
    + PX_KID_STEPS.filter(s => !s || s < total).map(s => `<button data-pxkn="${pxEsc(e.key)}|${s}" aria-pressed="${n === s}">${s || 'All'}</button>`).join('')
    + '</div></div></td></tr>';
}
function pxRangeTable(rows, ctx, tot) {
  const sku = PX.level === 'child', vis = PX_RCOLS.filter(x => pxShown(x[0]));
  const head = '<tr>' + pxTh('Product', 't', 'l stick') + (sku ? pxTh('SKU', 'sku', 'l') : '') + vis.map(x => pxTh(x[1], x[0])).join('') + '</tr>';
  const totRow = `<tr class="px-total"><td class="l stick">All ${ctx.found.length.toLocaleString('en-US')} ${sku ? 'child ASINs' : 'parents'}</td>${sku ? '<td></td>' : ''}${pxRangeCells(tot, true)}</tr>`;
  const body = rows.map(e => {
    let h = `<tr><td class="l stick">${pxProd(e)}</td>${sku ? `<td class="l px-sku">${pxEsc(e.sku)}</td>` : ''}${pxRangeCells(e.st)}</tr>`;
    if (!sku && PX.open.has(e.key) && e.asins.length > 1) {
      const { kids, total } = pxKids(e, ctx);
      h += kids.map(k => `<tr class="px-child"><td class="l stick">${pxProd(k, true)}</td>${pxRangeCells(k.st)}</tr>`).join('') + pxKidBar(e, total);
    }
    return h;
  }).join('');
  return `<table class="px-tbl"><thead>${head}</thead><tbody>${totRow}${body || `<tr><td class="l px-dim" colspan="12">Nothing matches.</td></tr>`}</tbody></table>`;
}
function pxColTable(rows, ctx) {
  const sku = PX.level === 'child', cs = ctx.cols, m = PX.metric, today = sdToday();
  const hue = m === 'tacos' || m === 'acos' ? 'var(--bad)' : m === 'spend' ? '#C98A4B' : m === 'op' ? 'var(--accent)' : 'var(--brand)';
  const head = '<tr>' + pxTh('Product', 't', 'l stick') + (sku ? pxTh('SKU', 'sku', 'l') : '')
    + cs.map((c, k) => { const live = c.hi >= today, d = pxLen(c.lo, c.hi);
      return pxTh(pxColLabel(c.lo, c.hi), 'c:' + k, live ? 'px-part' : '', c.src === 'none' ? 'no data' : live ? 'so far' : d === 1 ? '1 day' : d + ' days'); }).join('')
    + (cs.length > 1 ? pxTh('vs column before', 'chg', '', 'last full column') : '') + '</tr>';
  const row = (e, cls, kid) => {
    const vals = cs.map(c => pxStats(e.asins, c)[m]);
    const mx = Math.max(0, ...vals.filter(v => v != null));
    const cells = vals.map((v, k) => {
      const w = v == null ? 0 : pxIsPct(m) ? (m === 'tacos' ? Math.min(v, 50) * 2 : Math.min(v, 100)) : mx ? v / mx * 100 : 0;
      return `<td class="px-wk${cs[k].hi >= today ? ' px-part' : ''}${PX.anim ? ' px-cin" style="animation-delay:' + k * 26 + 'ms"' : '"'}>`
        + `<div class="px-cb"><span>${pxFmtM(m, v)}</span><i style="background:${hue};width:${(Math.max(w, 3) * 0.56).toFixed(1)}px"></i></div></td>`;
    }).join('');
    let chg = '';
    if (cs.length > 1) {
      const c = pxChange(e, ctx);
      chg = '<td>' + (c ? `<span class="px-chg ${Math.abs(c.v) < 0.05 ? 'px-dim' : (pxLowGood(m) ? c.v < 0 : c.v > 0) ? 'px-pos' : 'px-neg'}">${c.v > 0 ? '▲ ' : '▼ '}${Math.abs(c.v).toFixed(1)}${c.pt ? ' pt' : '%'}</span>` : '<span class="px-dim">—</span>') + '</td>';
    }
    const first = cls === 'px-total' ? `All ${ctx.found.length.toLocaleString('en-US')} ${sku ? 'child ASINs' : 'parents'}` : pxProd(e, kid);
    return `<tr${cls ? ` class="${cls}"` : ''}><td class="l stick">${first}</td>${sku ? `<td class="l px-sku">${cls === 'px-total' ? '' : pxEsc(e.sku || '')}</td>` : ''}${cells}${chg}</tr>`;
  };
  const allAsins = ctx.found.flatMap(e => e.asins);
  const body = rows.map(e => {
    let h = row(e);
    if (!sku && PX.open.has(e.key) && e.asins.length > 1) {
      const { kids, total } = pxKids(e, ctx);
      h += kids.map(k => row(k, 'px-child', true)).join('') + pxKidBar(e, total);
    }
    return h;
  }).join('');
  return `<table class="px-tbl"><thead>${head}</thead><tbody>${row({ asins: allAsins }, 'px-total')}${body || `<tr><td class="l px-dim" colspan="20">Nothing matches.</td></tr>`}</tbody></table>`;
}

function pxDatePop() {
  const d = PX.draft, min = WDAY.from || '', max = sdToday();
  return `<div class="px-pop" style="left:16px" role="dialog" aria-label="Pick dates"><div class="px-pop-h"><b>Pick dates</b><span>${WDAY.from ? 'Day by day from ' + pxEsc(pxDM(WDAY.from)) : ''}</span></div>`
    + `<div class="px-frow"><span>From</span><input class="px-inp" type="date" id="pxFrom" ${min ? `min="${min}"` : ''} max="${max}" value="${d.lo}"></div>`
    + `<div class="px-frow"><span>To</span><input class="px-inp" type="date" id="pxTo" ${min ? `min="${min}"` : ''} max="${max}" value="${d.hi}"></div>`
    + '<div class="px-note">Compared with the same number of days just before.</div>'
    + '<div class="px-pop-f"><button class="px-btn" data-px="cancel">Cancel</button><button class="px-btn px-dark" data-px="applydate">Apply</button></div></div>';
}
function pxColsPop() {
  const d = PX.draft;
  return '<div class="px-pop" style="left:16px" role="dialog" aria-label="Set up columns"><div class="px-pop-h"><b>Set up columns</b><span>Each column adds up its days</span></div>'
    + '<div class="px-presets">' + PX_COLP.map(p => `<button class="px-preset" data-pxcp="${p[0]}" aria-pressed="${d.preset === p[0]}">${p[1]}</button>`).join('') + '</div>'
    + `<div class="px-frow"><span>Number of columns</span><div class="px-step"><button data-pxdn="-1" aria-label="Fewer columns">−</button><b>${d.n}</b><button data-pxdn="1" aria-label="More columns">+</button></div></div>`
    + '<div class="px-frow"><span>Days in each column</span><div class="px-tb"><div class="px-seg px-segsm">'
    + [1, 7, 14, 30].map(n => `<button data-pxdl="${n}" aria-pressed="${!(d.preset === 'month' || d.preset === 'lmonth') && d.len === n}">${n}</button>`).join('')
    + `</div><input class="px-inp px-num" type="number" id="pxLenIn" min="1" max="90" value="${d.len}" aria-label="Days in each column"></div></div>`
    + `<div class="px-frow"><span>Last column ends on</span><input class="px-inp" type="date" id="pxEndIn" max="${sdToday()}" value="${d.end || sdShift(sdToday(), -1)}"></div>`
    + '<div class="px-pop-f"><button class="px-btn" data-px="cancel">Cancel</button><button class="px-btn px-dark" data-px="applycols">Apply</button></div></div>';
}
function pxShowPop() {
  return '<div class="px-pop" style="right:16px" role="dialog" aria-label="Show columns"><div class="px-pop-h"><b>Show columns</b><span>Product is always shown</span></div>'
    + '<div class="px-colgrid">' + PX_RCOLS.map(x => `<label class="px-chk"><input type="checkbox" data-pxhide="${x[0]}"${pxShown(x[0]) ? ' checked' : ''}> ${x[1]}</label>`).join('') + '</div>'
    + '<div class="px-pop-f"><button class="px-btn" data-px="showall">Show all</button><button class="px-btn px-dark" data-px="cancel">Done</button></div></div>';
}

function pxRender(focusSel) {
  const pane = $('panePpcn'); if (!pane) return;
  PX_MEMO = new Map();
  const old = pane.querySelector('.px-tw'), sc = old ? [old.scrollLeft, old.scrollTop] : null;
  const cm = PX.mode === 'cols';
  const empty = !Object.keys(WEEKLY.rows).length && !Object.keys(WDAY.rows).length;
  const ctx = pxCtx();
  const filtered = ctx.found.filter(e => PX_FILTERS[PX.chip][1](e.st));
  const sorted = pxSorted(filtered, ctx);
  const shown = sorted.slice(0, PX.show);
  const tot = pxStats(ctx.found.flatMap(e => e.asins), ctx.span, true);

  const allowed = adBrands();
  const brandSeg = allowed.length > 1
    ? '<div class="px-seg" role="group" aria-label="Brand">' + [['ALL', 'Both']].concat(allowed.map(b => [b, BRAND_NAME[b] || b]))
      .map(([k, l]) => `<button data-pxbrand="${k}" aria-pressed="${PX.brand === k}">${pxEsc(l)}</button>`).join('') + '</div>'
    : `<span class="px-lock">${pxEsc(BRAND_NAME[allowed[0]] || allowed[0] || '')}</span>`;
  const viewSeg = `<div class="px-seg px-view" role="group" aria-label="View"><button data-pxmode="range" aria-pressed="${!cm}">${PX_IC_RANGE}Range report</button><button data-pxmode="cols" aria-pressed="${cm}">${PX_IC_COLS}Columns by date</button></div>`;
  const lvl = `<div class="px-seg" role="group" aria-label="Parent or child"><button data-pxlevel="parent" aria-pressed="${PX.level === 'parent'}">Parent</button><button data-pxlevel="child" aria-pressed="${PX.level === 'child'}">Child</button></div>`;
  const search = '<label class="px-search px-grow"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pxQ" placeholder="Search product, ASIN or SKU" autocomplete="off"></label>';
  const showBtn = cm ? '' : `<button class="px-btn${PX.hide.length ? ' px-on' : ''}" data-px="pop-show" aria-expanded="${PX.pop === 'show'}">${PX_IC_COLS}Columns${PX.hide.length ? ' · ' + (PX_RCOLS.length - PX.hide.length) : ''}</button>`;
  const chips = '<span class="px-lbl">Quick filters</span>' + Object.entries(PX_FILTERS).map(([k, v]) =>
    `<button class="px-chipf" data-pxchip="${k}" aria-pressed="${PX.chip === k}">${v[0]} <b>${ctx.found.filter(e => v[1](e.st)).length}</b></button>`).join('');

  const strip = `<div class="px-card px-clip"><div class="px-strip">
    <div><small>Sales</small><b>${tot.has ? pxMoney(tot.rev) : '—'}</b><em class="${tot.vp == null ? 'px-dim' : tot.vp < 0 ? 'px-neg' : 'px-pos'}">${pxSgn(tot.vp)} vs prev</em></div>
    <div><small>Ad spend</small><b>${pxMoney(tot.spend)}</b><em class="px-dim">ad sales ${pxMoney(tot.adSales)}</em></div>
    <div><small>Organic share</small><b>${pxPct(tot.op)}</b><em class="px-dim">${pxMoney(tot.os)} organic</em></div>
    <div><small>ACoS</small><b>${pxPct(tot.acos)}</b><em class="px-dim">spend ÷ ad sales</em></div>
    <div><small>TACoS</small><b>${pxPct(tot.tacos)}</b><em class="px-dim">spend ÷ all sales</em></div></div></div>`;

  let hbar;
  if (!cm) {
    const [lo, hi] = pxRange(), L = lo && hi ? pxLen(lo, hi) : 0;
    const prev = L ? pxFmtRange(sdShift(lo, -L), sdShift(lo, -1)) : '—';
    hbar = '<div class="px-hbar"><div class="px-dchips" role="group" aria-label="Dates">'
      + Object.entries(PX_DATES).map(([k, v]) => `<button class="px-dchip" data-pxdk="${k}" aria-pressed="${PX.dkey === k}">${v[0]}</button>`).join('')
      + `<button class="px-dchip" data-px="pop-date" aria-pressed="${PX.dkey === 'custom'}" aria-expanded="${PX.pop === 'date'}">${PX.dkey === 'custom' ? pxFmtRange(lo, hi) + ' ▾' : 'Custom ▾'}</button></div>`
      + `<div class="px-tb"><span class="px-rlabel"><b>${pxFmtRange(lo, hi)}${hi >= sdToday() ? ' (today so far)' : ''}</b> · vs ${prev}</span>`
      + `<button class="px-colsum" data-px="split">${PX_IC_COLS}Split into columns <span class="px-ed">＋</span></button></div>`
      + (PX.pop === 'date' ? pxDatePop() : '') + '</div>';
  } else {
    const cs = ctx.cols;
    hbar = `<div class="px-hbar"><button class="px-colsum" data-px="pop-cols" aria-expanded="${PX.pop === 'cols'}">${PX_IC_COLS}${pxEsc(pxColsDesc(PX.pc))} <small>${pxFmtRange(cs[0].lo, cs[cs.length - 1].hi)}</small><span class="px-ed">Edit</span></button>`
      + '<div class="px-tb"><span class="px-lbl">Each column shows</span><div class="px-seg px-segsm" role="group" aria-label="Each column shows">'
      + Object.entries(PX_METRICS).map(([k, v]) => `<button data-pxm="${k}" aria-pressed="${PX.metric === k}">${v}</button>`).join('') + '</div></div>'
      + (PX.pop === 'cols' ? pxColsPop() : '') + '</div>';
  }
  // Say plainly when the dates cannot be answered, rather than showing a column of dashes.
  let warn = '';
  const nonePlans = cm ? ctx.cols.filter(c => c.src === 'none') : (ctx.span.src === 'none' ? [ctx.span] : []);
  if (!empty && nonePlans.length) {
    warn = `<div class="px-warn">${cm ? nonePlans.length + ' column' + (nonePlans.length === 1 ? '' : 's') + ' fall' + (nonePlans.length === 1 ? 's' : '') : 'These dates fall'} before ${WDAY.from ? '<b>' + pxEsc(pxFmtRange(WDAY.from, WDAY.from)) + '</b>, where the day-by-day figures start' : 'the day-by-day figures'}. Earlier dates can only be shown as whole Sunday–Saturday weeks.</div>`;
  }
  const n = filtered.length;
  const more = n > shown.length ? `<button class="px-btn" data-px="more">Show ${Math.min(PX_PAGE, n - shown.length)} more</button>` : '';
  const foot = `<div class="px-foot"><span>${shown.length.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} ${PX.level === 'child' ? 'child ASINs' : 'parents'} shown${!cm && PX.level === 'parent' ? ' · click “sizes” to open a parent' : ''}${cm ? ' · striped columns include today, so they are not complete yet' : ''}</span>${more}</div>`;
  const stamp = WDAY.at || WEEKLY.at;
  const fresh = PX.msg ? `<span class="px-fresh px-busy">${pxEsc(PX.msg)}</span>` : stamp ? `<span class="px-fresh">Up to date · nightly run ${pxEsc(stamp)}</span>` : '';

  const table = empty
    ? `<div class="px-empty">${PX.loading ? 'Loading the PPC figures…' : 'No PPC figures stored yet. Open the old PPC &amp; Organic tab and press Refresh, or wait for tonight’s run.'}</div>`
    : `<div class="px-tw${PX.anim ? ' px-swap' : ''}">${cm ? pxColTable(shown, ctx) : pxRangeTable(shown, ctx, tot)}</div>${foot}`;

  pane.innerHTML = `<div class="px-main">
    <div class="px-ph"><div class="px-tb"><span class="px-testtag">Test page</span>${fresh}</div><span class="px-note">The old PPC &amp; Organic tab is unchanged.</span></div>
    <div class="px-card px-toolbar"><div class="px-tb">${viewSeg}<span class="px-vsep"></span>${brandSeg}${lvl}${search}${showBtn}<button class="px-btn" data-px="csv">Download</button></div>
      <div class="px-row2">${chips}</div>${PX.pop === 'show' ? pxShowPop() : ''}</div>
    ${strip}
    <div class="px-card px-flush">${hbar}${warn}${table}</div></div>`;

  const q = $('pxQ'); if (q) q.value = PX.q;
  if (sc && !PX.anim) { const t = pane.querySelector('.px-tw'); if (t) { t.scrollLeft = sc[0]; t.scrollTop = sc[1]; } }
  PX.anim = false;
  pxSave();
  if (focusSel) { const el = pane.querySelector(focusSel); if (el) { el.focus(); if (el.id === 'pxQ') el.setSelectionRange(el.value.length, el.value.length); } }
}

/* ---------- download ---------- */
function pxCsv() {
  const ctx = pxCtx();
  const list = pxSorted(ctx.found.filter(e => PX_FILTERS[PX.chip][1](e.st)), ctx);
  const sku = PX.level === 'child', q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const num = (v, d) => (v == null ? '' : (+v).toFixed(d));
  let head, rows;
  if (PX.mode === 'cols') {
    head = ['ASIN', 'Title'].concat(sku ? ['SKU'] : []).concat(ctx.cols.map(c => PX_METRICS[PX.metric] + ' ' + c.lo + '..' + c.hi));
    rows = list.map(e => [e.key, e.title].concat(sku ? [e.sku] : []).concat(ctx.cols.map(c => num(pxStats(e.asins, c)[PX.metric], 2))));
  } else {
    head = ['ASIN', 'Title'].concat(sku ? ['SKU'] : []).concat(['Units', 'Sales', 'Ad spend', 'Ad sales', 'Organic sales', 'Organic %', 'ACoS %', 'TACoS %', 'vs prev %']);
    rows = list.map(e => { const s = e.st; return [e.key, e.title].concat(sku ? [e.sku] : [])
      .concat([num(s.u, 0), num(s.rev, 2), num(s.spend, 2), num(s.adSales, 2), num(s.os, 2), num(s.op, 1), num(s.acos, 1), num(s.tacos, 1), num(s.vp, 1)]); });
  }
  const csv = [head].concat(rows).map(r => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const [lo, hi] = PX.mode === 'cols' ? [ctx.cols[0].lo, ctx.cols[ctx.cols.length - 1].hi] : [ctx.span.lo, ctx.span.hi];
  a.download = `ppc-organic-${PX.level}-${lo}_${hi}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- wiring: one set of delegated listeners, attached once ---------- */
function pxWire() {
  const pane = $('panePpcn');
  if (!pane || pane.dataset.wired) return;
  pane.dataset.wired = '1';
  const go = (anim, focus) => { if (anim) PX.anim = true; pxRender(focus); };
  pane.addEventListener('click', e => {
    const t = e.target.closest('button,[data-pxsort]'); if (!t || !pane.contains(t)) return;
    const d = t.dataset;
    if (d.pxmode) { if (d.pxmode !== PX.mode) { PX.mode = d.pxmode; PX.pop = null; PX.show = PX_PAGE; if (PX.sk.startsWith('c:') || PX.sk === 'chg') PX.sk = 'rev'; go(true); } return; }
    if (d.pxbrand) { PX.brand = d.pxbrand; PX.show = PX_PAGE; return go(); }
    if (d.pxlevel) { PX.level = d.pxlevel; PX.show = PX_PAGE; if (PX.sk === 'sku' && PX.level === 'parent') PX.sk = 'rev'; return go(true); }
    if (d.pxdk) { PX.dkey = d.pxdk; PX.pop = null; return go(true); }
    if (d.pxchip) { PX.chip = d.pxchip; PX.show = PX_PAGE; return go(); }
    if (d.pxopen) { const k = d.pxopen; PX.open.has(k) ? PX.open.delete(k) : PX.open.add(k); return go(); }
    if (d.pxkn) { const cut = d.pxkn.lastIndexOf('|'); PX.kidN[d.pxkn.slice(0, cut)] = +d.pxkn.slice(cut + 1); return go(); }
    if (d.pxm) { PX.metric = d.pxm; if (PX.sk.startsWith('c:') || PX.sk === 'chg') PX.sk = 'rev'; return go(true); }
    if (d.pxsort) {
      const k = d.pxsort;
      if (PX.sk === k) PX.sd = -PX.sd; else { PX.sk = k; PX.sd = (k === 't' || k === 'sku') ? 1 : -1; }
      return go();
    }
    // the column builder's draft
    if (d.pxcp) {
      const p = PX_COLP.find(x => x[0] === d.pxcp);
      if (p[2]) Object.assign(PX.draft, { n: p[2], len: p[3], end: '', preset: p[0] });
      else { const cs = pxCols({ preset: p[0] }); Object.assign(PX.draft, { n: cs.length, len: 7, end: cs[cs.length - 1][1], preset: p[0] }); }
      return go();
    }
    if (d.pxdn) { PX.draft.n = Math.max(1, Math.min(12, PX.draft.n + +d.pxdn)); PX.draft.preset = null; return go(); }
    if (d.pxdl) { PX.draft.len = +d.pxdl; PX.draft.preset = null; return go(); }
    switch (d.px) {
      case 'pop-date': case 'pop-cols': case 'pop-show': {
        const w = d.px.slice(4);
        if (PX.pop === w) { PX.pop = null; return go(); }
        PX.pop = w;
        if (w === 'date') { const [lo, hi] = pxRange(); PX.draft = { lo, hi }; }
        if (w === 'cols') PX.draft = Object.assign({}, PX.pc);
        return go();
      }
      case 'split': PX.mode = 'cols'; PX.pop = 'cols'; PX.draft = Object.assign({}, PX.pc); if (PX.sk === 'vp') PX.sk = 'rev'; return go(true);
      case 'cancel': PX.pop = null; return go();
      case 'applydate': {
        const a = PX.draft.lo, b = PX.draft.hi;
        if (a && b) { PX.lo = a <= b ? a : b; PX.hi = a <= b ? b : a; PX.dkey = 'custom'; }
        PX.pop = null; return go(true);
      }
      case 'applycols': PX.pc = Object.assign({}, PX.draft); PX.pop = null; if (PX.sk.startsWith('c:')) PX.sk = 'rev'; return go(true);
      case 'showall': PX.hide = []; return go();
      case 'more': PX.show += PX_PAGE; return go();
      case 'csv': return pxCsv();
    }
  });
  pane.addEventListener('keydown', e => {
    const t = e.target.closest('[data-pxsort]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
  });
  pane.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'pxFrom' && t.value) PX.draft.lo = t.value;
    if (t.id === 'pxTo' && t.value) PX.draft.hi = t.value;
    if (t.id === 'pxLenIn') { PX.draft.len = Math.max(1, Math.min(90, Math.round(+t.value || 1))); PX.draft.preset = null; go(false, '#pxLenIn'); }
    if (t.id === 'pxEndIn' && t.value) { PX.draft.end = t.value; PX.draft.preset = null; go(); }
    if (t.dataset.pxhide) {
      const k = t.dataset.pxhide;
      PX.hide = t.checked ? PX.hide.filter(x => x !== k) : PX.hide.concat(k);
      if (PX.hide.length >= PX_RCOLS.length) PX.hide = PX.hide.slice(1);   // never hide every column
      go();
    }
  });
  let qt = null;
  pane.addEventListener('input', e => {
    if (e.target.id !== 'pxQ') return;
    clearTimeout(qt);
    qt = setTimeout(() => { PX.q = e.target.value; PX.show = PX_PAGE; pxRender('#pxQ'); }, 200);
  });
  // A panel closes on a click outside it, or on Escape — it hangs over the work, so it does not linger.
  document.addEventListener('mousedown', e => {
    if (!PX.pop || TAB_NOW !== 'ppcn') return;
    if (e.target.closest('.px-pop,[data-px^="pop-"],[data-px="split"]')) return;
    PX.pop = null; pxRender();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && PX.pop && TAB_NOW === 'ppcn') { PX.pop = null; pxRender(); }
  });
}

async function ensurePpcn() {
  pxWire();
  PX.loading = true;
  pxRender();
  if (!H_LOADED) await loadHealthCache();          // ASIN → brand, title, parent and SKU come from here
  PX_LOOK = null;
  if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) await loadWeekly();
  PX.loading = false;
  pxRender();
  pxImages();                                       // pictures fill in when they arrive
  // The day-by-day store lives in memory only and is filled by the nightly merge — the same call, and
  // the same ten-minute throttle, as the old tab, so opening both costs one merge, not two.
  if (!W_BUSY && Date.now() - W_NIGHT_RUN > 600000) {
    PX.msg = 'Bringing in last night’s figures…';
    pxRender();
    let from = '';
    try { from = await wNightly(); } catch (e) { /* whatever is stored stays on screen */ }
    PX.msg = '';
    if (from) WEEKLY.at = WEEKLY.at || from;
    if (TAB_NOW === 'ppcn') pxRender();
  }
}
