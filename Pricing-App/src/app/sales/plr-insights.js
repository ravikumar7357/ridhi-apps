/* ================= SALES · PARENT LISTING REVIEW — INTERACTIVE (28 Nov 2026) =================
 * Screen: Sales → Analyse → Parent Listing Review. Its data, maths and table are sales/parent-listing-review.js, UNCHANGED (plRows,
 *   plAction, plSubtotal and the TOTAL row, the columns, the sort, the filters, Refresh stock & ranks, Export, the parent card). Added:
 *   · a 📅 WEEK picker in the (now sticky) toolbar: every completed week that has data, newest first (default: the latest — as before);
 *   · a STORY LINE from the plAction counts ("Last week (16–22 Nov) 8 parents need stock, 5 lost traffic, 3 spend too much on ads; 120
 *     are healthy. Biggest worry: Stripe Tablecloth (−38% vs 6-week average, 9 days of stock).");
 *   · ACTION CARDS — the existing action names grouped, nothing new: 📦 Restock (Restock — out / low) · 👀 Low traffic (Traffic drop,
 *     Fix the page) · 💸 Ad spend high (Cut spend, Spend too high) · 📉 Sales down (Overstocked: high cover and sales falling) · ✅ Healthy
 *     (Steady, New — watch, Add budget); each with its count and top 3 parents by money at stake; a click filters the table, again = all;
 *   · a KPI STRIP: sales last week vs the 6-week average, ad spend last week vs its 6-week average, parents with under 30 days of stock,
 *     parents ranking worse (the BSR snapshots: the newest week against the one before, bsr-audit.js bsrMove);
 *   · the table shows the TOP 15 parents (its own sort) with "Show other N parents ▾" / "Show fewer ▴"; a search or a card shows every
 *     match; the TOTAL row and Export still cover every parent of the filters (as before);
 *   · a row click opens a SIDE PANEL: photo, name, the action in one line + "+ Task", a 6-week chart (weekly sales bars + ad spend line,
 *     last week highlighted), stock and days of cover (the Forecast's when it is loaded), the rank as Amazon writes it, the children
 *     (sales, stock, ad spend), links to Listing Health · BSR Audit · Sales Alerts, and the existing parent card ("All figures").
 * The insights read the brand's parents for the week (before the type / action / search filters). READ-ONLY. ECharts via the Sales
 *   Dashboard's loader (sdcLoadCharts), a plain bar list without it; ✨ off = no animation. Names plx / PLX. Tests: tests/plr-test.js. */

const PLX_M = { top: 15, lowDays: 30, daysPerMonth: 30.4 };
// The cards: the existing plAction names, grouped (no new rule).
const PLX_CARDS = [
  { k: 'stock', e: '📦', t: 'Restock', acts: ['Restock — out', 'Restock — low'], say: n => `${n} parent${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} stock` },
  { k: 'traffic', e: '👀', t: 'Low traffic', acts: ['Traffic drop', 'Fix the page'], say: n => `${n} lost traffic` },
  { k: 'spend', e: '💸', t: 'Ad spend high', acts: ['Cut spend', 'Spend too high'], say: n => `${n} spend too much on ads` },
  { k: 'down', e: '📉', t: 'Sales down', acts: ['Overstocked'], say: n => `${n} ${n === 1 ? 'has' : 'have'} sales down` },
  { k: 'ok', e: '✅', t: 'Healthy', acts: ['Steady', 'New — watch', 'Add budget'], say: n => `${n} ${n === 1 ? 'is' : 'are'} healthy` },
];
// The Action Tracker quick pick (TK_PICKS) a "+ Task" starts on, per action.
const PLX_PICK = { 'Restock — out': 'stock', 'Restock — low': 'stock', 'Traffic drop': 'ads', 'Fix the page': 'listing', 'Cut spend': 'ads', 'Spend too high': 'ads', 'Add budget': 'ads', Overstocked: 'price' };
const PLX = { week: '', card: '', all: false, panel: '', chart: null, shell: false };
const plxEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const PLX_NUM = new Intl.NumberFormat('en-US');
const plxMoney = v => (v == null ? '—' : (v < 0 ? '−' : '') + '$' + PLX_NUM.format(Math.round(Math.abs(v))));
const plxEl = id => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);
/** A parent's card: its action's card — but a parent Sales Alerts confirms as a drop for the week (row.al, plxMark) is 📉 Sales down,
 *  never ✅ Healthy. (A stock / traffic / spend problem keeps its own card: one card per parent, as plAction asks stock first.) */
function plxCardOf(row) {
  const c = PLX_CARDS.find(x => x.acts.includes(row.action)) || PLX_CARDS[4];
  return c.k === 'ok' && row.al ? PLX_CARDS[3] : c;
}
/** Money at stake for a parent, for its card's top 3: a week's average sales for stock, a lost week (average − last week) for traffic
 *  and sales down (Sales Alerts' $ a week at risk when it is a confirmed drop), last week's ad spend for spend, last week's sales for healthy. */
function plxStake(row) {
  const k = plxCardOf(row).k;
  if (k === 'stock') return row.avgSales || row.lwSales || 0;
  if (k === 'spend') return row.lwSpend || 0;
  if (k === 'down' && row.al && row.al.atRisk > 0) return row.al.atRisk;
  if (k === 'traffic' || k === 'down') return Math.max(0, (row.avgSales || 0) - (row.lwSales || 0));
  return row.lwSales || 0;
}

/* ----- Sales Alerts: its confirmed drops, from its ONE result (alFor, sales-alerts.js — the page, the Dashboard card, the Forecast and
 *   the Action Tracker read the same object). Read-only: when it is not loaded yet, its own loader (alLoad) is started once. ----- */
const PLX_AL_SEV = { critical: '🔴 Critical', important: '🟠 Important', watch: '🟡 Watch' };
/** Mark each row with the Sales Alerts drop of its parent whose days touch the week shown (row.al = { sev, drop, atRisk, from, to }, else
 *  null) and say how Sales Alerts stands: PLX.alState 'ok' | 'loading' | 'none' (not loaded / not allowed / failed). */
function plxMark(rows, week) {
  rows.forEach(r => { r.al = null; });
  PLX.alState = 'none';
  if (typeof AL === 'undefined' || typeof alFor !== 'function') return;
  if (!AL.data || typeof VI === 'undefined' || !VI.data) {
    if (!PLX.alAsked && typeof alLoad === 'function' && (typeof alMay !== 'function' || alMay('salert'))) {
      PLX.alAsked = true;
      PLX.alBusy = true;
      let job;
      try { job = alLoad(); } catch (e) { job = null; }
      Promise.resolve(job).catch(() => null).then(() => {
        PLX.alBusy = false;
        const pane = plxEl('panePlaudit');
        if (typeof renderPlaudit === 'function' && (!pane || !pane.classList || !pane.classList.contains('hide'))) renderPlaudit();
      });
    }
    if (PLX.alBusy) PLX.alState = 'loading';
    return;
  }
  if (!week) return;
  const end = typeof sdShift === 'function' ? sdShift(week, 6) : week;
  const by = {};
  [...new Set(rows.map(r => r.brand))].forEach(b => {
    let res = null;
    try { res = alFor(b); } catch (e) { res = null; }
    if (!res || !res.ok) return;
    PLX.alState = 'ok';
    res.alerts.forEach(a => { if (PLX_AL_SEV[a.sev] && a.from <= end && a.to >= week && !by[a.key]) by[a.key] = a; });
  });
  rows.forEach(r => { const a = by[r.brand + '|' + r.parent]; if (a) r.al = { sev: a.sev, drop: a.drop, atRisk: a.atRisk, from: a.from, to: a.to }; });
}
const plxAlTxt = al => `${PLX_AL_SEV[al.sev]} −${Math.round(al.drop)}%`;
const plxDays = row => (row.stock === 0 ? 0 : row.dos == null ? null : row.dos * PLX_M.daysPerMonth);
/** The insights of a set of rows (plRows' rows for the brand and week): { cards: [{ k, n, top3 }], kpi, story }. Pure. */
function plxModel(rows, ctx) {
  const c = ctx || {};
  const cards = PLX_CARDS.map(card => {
    const list = rows.filter(r => plxCardOf(r).k === card.k);
    return Object.assign({}, card, { n: list.length, top3: list.slice().sort((a, b) => plxStake(b) - plxStake(a)).slice(0, 3).map(r => ({ key: r.brand + '|' + r.parent, title: r.title || r.parent, stake: plxStake(r), action: r.action, why: r.why, al: r.al || null })) });
  });
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const kpi = { lwSales: sum('lwSales'), avgSales: sum('avgSales'), lwSpend: c.lwSpend == null ? null : c.lwSpend, avgSpend: c.avgSpend == null ? null : c.avgSpend,
    low: rows.filter(r => { const d = plxDays(r); return d != null && d < PLX_M.lowDays && (r.lwUnits > 0 || r.stock === 0 && r.lwSales > 0); }).length,
    worse: c.worse == null ? null : c.worse, n: rows.length };
  // the story: the counts, then the biggest worry (the problem parent with the most money at stake)
  const by = k => cards.find(x => x.k === k).n;
  const parts = ['stock', 'traffic', 'spend', 'down'].filter(k => by(k)).map(k => PLX_CARDS.find(x => x.k === k).say(by(k)));
  const okN = by('ok');
  const head = c.weekLabel ? `Last week (${c.weekLabel})` : 'Last week';
  let story = parts.length ? `${head} ${parts.join(', ')}${okN ? `; ${PLX_CARDS[4].say(okN)}` : ''}.` : `${head} all ${okN} parents are healthy.`;
  const worry = rows.filter(r => plxCardOf(r).k !== 'ok').sort((a, b) => plxStake(b) - plxStake(a))[0];
  if (worry) {
    const bits = [];
    if (worry.diff != null) bits.push(`${worry.diff < 0 ? '−' : '+'}${Math.round(Math.abs(worry.diff) * 100)}% vs 6-week average`);
    if (worry.al) bits.push(`Sales Alerts ${plxAlTxt(worry.al)}`);
    const d = plxDays(worry);
    if (d != null) bits.push(`${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} of stock`);
    story += ` Biggest worry: ${worry.title || worry.parent}${bits.length ? ` (${bits.join(', ')})` : ''}.`;
  }
  return { cards, kpi, story };
}
/** Which rows the table draws: every match of a search; a card's (all of them); all (Show other N); else the top 15. */
function plxLimit(rows, search) {
  if (PLX.card || search || PLX.all) return { shown: rows, rest: 0, all: !PLX.card && !search && rows.length > PLX_M.top };
  return { shown: rows.slice(0, PLX_M.top), rest: Math.max(0, rows.length - PLX_M.top) };
}
/** The card filter, on the table's rows (after its own filters; never while searching — a search looks through every parent). */
function plxFilter(rows) {
  if (!PLX.card) return rows;
  return PLX_CARDS.some(c => c.k === PLX.card) ? rows.filter(r => plxCardOf(r).k === PLX.card) : rows;
}

/* ----- drawing ----- */
const plxFx = () => {
  let on = typeof sdcFxSaved === 'function' ? sdcFxSaved() : true;
  try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) on = false; } catch (e) { /* as saved */ }
  return on;
};
// The week picker's choices: every completed week of the weekly store with any sales, newest first.
function plxWeeks() {
  if (typeof WEEKLY === 'undefined') return [];
  const all = WEEKLY.weeks && WEEKLY.weeks.length ? WEEKLY.weeks : (typeof wWeeksList === 'function' ? wWeeksList(26) : []);
  const thisWeek = typeof wKeyOfDate === 'function' && typeof sdToday === 'function' ? wKeyOfDate(sdToday()) : '';
  const has = new Set();
  Object.values(WEEKLY.rows || {}).forEach(r => Object.keys(r.weeks || {}).forEach(w => { const c = r.weeks[w]; if (c && (c.rev || c.u)) has.add(w); }));
  const done = all.filter(w => w < thisWeek);
  const latest = done[done.length - 1];   // always offered: it is the table's default "last week" (as before), data or not
  return done.filter(w => has.has(w) || w === latest).slice().reverse();
}
/** The frame above the table (skeletons until the rows are worked out). */
function plxShell() {
  const el = plxEl('plIns');
  if (!el || PLX.shell) return;
  PLX.shell = true;
  el.innerHTML = '<p class="plx-story" id="plxStory"><span class="plx-sk plx-sk-line"></span></p><div class="plx-kpis" id="plxKpis"><i class="plx-sk"></i><i class="plx-sk"></i><i class="plx-sk"></i><i class="plx-sk"></i></div>'
    + '<div class="plx-cards" id="plxCards" role="group" aria-label="What to do — click a card to show only its parents"><i class="plx-sk"></i><i class="plx-sk"></i><i class="plx-sk"></i><i class="plx-sk"></i><i class="plx-sk"></i></div>';
}
/** Called by renderPlaudit after the table: the week picker, the story, the KPIs, the cards, "Show other N", the panel. */
function plxAfter(lim, info) {
  plxShell();
  if (!PLX.topped) { PLX.topped = true; if (typeof requestAnimationFrame === 'function') requestAnimationFrame(plxTop); }
  // the week picker
  const sel = plxEl('plWeek');
  if (sel) {
    const weeks = plxWeeks();
    const label = w => (typeof wLabel === 'function' ? wLabel(w) : w);
    sel.innerHTML = weeks.map((w, i) => `<option value="${i ? w : ''}"${(i ? w === PLX.week : !PLX.week) ? ' selected' : ''}>${plxEsc(label(w))}${i ? '' : ' (latest)'}</option>`).join('');
  }
  // the insights: the brand's parents for the week and type, before the action / card / search filters (plRows' `every`)
  const all = (info && info.every) || [];
  PLX.lastAll = all;
  const W = (info && info.weekly) || {};
  const spendOf = weeks => { let t = 0, seen = false; Object.values(W).forEach(byW => weeks.forEach(w => { const c = byW[w]; if (c && c.spend != null) { t += c.spend; seen = true; } })); return seen ? t : null; };
  const avgW = (info && info.avgWeeks) || [];
  const lwSp = info && info.lastWeek ? spendOf([info.lastWeek]) : null;
  const avgSp = avgW.length ? (s => (s == null ? null : s / avgW.length))(spendOf(avgW)) : null;
  const worse = plxWorse(all);
  const m = plxModel(all, { lwSpend: lwSp, avgSpend: avgSp, worse, weekLabel: info && info.lastWeek && typeof wLabel === 'function' ? wLabel(info.lastWeek) : '' });
  PLX.model = m;
  const story = plxEl('plxStory');
  if (story) story.textContent = m.story;
  const k = m.kpi;
  const ch = (a, b) => (a == null || !(b > 0) ? '' : `<span class="plx-d is-${a >= b ? 'up' : 'down'}">${a >= b ? '▲' : '▼'} ${Math.round(Math.abs(a - b) / b * 100)}%</span>`);
  const kp = plxEl('plxKpis');
  if (kp) kp.innerHTML = `<div class="plx-kpi"><span>Sales last week</span><b>${plxMoney(k.lwSales)}</b><small>${ch(k.lwSales, k.avgSales)} vs 6-week avg ${plxMoney(k.avgSales)}</small></div>`
    + `<div class="plx-kpi"><span>Ad spend last week</span><b>${plxMoney(k.lwSpend)}</b><small>${k.lwSpend == null ? 'no ad report for that week' : `${ch(k.lwSpend, k.avgSpend)} vs 6-week avg ${plxMoney(k.avgSpend)}`}</small></div>`
    + `<div class="plx-kpi${k.low ? ' is-bad' : ''}"><span>Under ${PLX_M.lowDays} days of stock</span><b>${PLX_NUM.format(k.low)}</b><small>parents (at last week's rate)</small></div>`
    + `<div class="plx-kpi"><span>Ranking worse</span><b>${k.worse == null ? '—' : PLX_NUM.format(k.worse)}</b><small>${k.worse == null ? 'one rank snapshot only' : 'parents (BSR snapshots, week on week)'}</small></div>`;
  const cards = plxEl('plxCards');
  // what each card covers; Sales down also says how Sales Alerts stands
  const covers = c => c.acts.join(' · ') + (c.k !== 'down' ? '' : PLX.alState === 'ok' ? ' · Sales Alerts drops' : PLX.alState === 'loading' ? ' · Sales Alerts loading…' : ' · Sales Alerts not checked yet');
  if (cards) cards.innerHTML = m.cards.map(c => `<button type="button" class="plx-card is-${c.k}${PLX.card === c.k ? ' is-on' : ''}" data-plx-card="${c.k}" aria-pressed="${PLX.card === c.k}" title="${plxEsc(covers(c))}"${c.n ? '' : ' disabled'}>`
    + `<span class="plx-ct">${c.e} ${plxEsc(c.t)}</span><b>${PLX_NUM.format(c.n)}</b><small class="muted">${plxEsc(covers(c))}</small>`
    + (c.top3.length ? `<ol>${c.top3.map(x => `<li><span>${plxEsc(x.title)}</span><em>${plxMoney(x.stake)}</em>${c.k === 'down' && x.al ? `<i class="plx-al" title="Sales Alerts: ${plxEsc(x.al.from)} → ${plxEsc(x.al.to)}">${plxEsc(plxAlTxt(x.al))}</i>` : ''}</li>`).join('')}</ol>` : '') + '</button>').join('');
  // under the table
  const more = plxEl('plMore');
  if (more) {
    const card = PLX.card && PLX_CARDS.find(c => c.k === PLX.card);
    const q = plxEl('plFilter') ? String(plxEl('plFilter').value || '').trim() : '';
    const act = plxEl('plAct') ? plxEl('plAct').value : 'ALL';
    more.innerHTML = q ? (card || act !== 'ALL' ? '<span class="muted">Searching every parent — the Action filter and the card are set aside while you search</span>' : '')
      : card ? `<span class="muted">Showing the ${card.e} ${plxEsc(card.t)} parents</span><button type="button" class="ghost plx-btn" data-plx="clear">Show all ✕</button>`
      : lim && lim.rest > 0 ? `<button type="button" class="ghost plx-btn" data-plx="more" aria-expanded="false">Show other ${PLX_NUM.format(lim.rest)} parent${lim.rest === 1 ? '' : 's'} ▾</button>`
      : lim && lim.all ? '<button type="button" class="ghost plx-btn" data-plx="fewer" aria-expanded="true">Show fewer ▴</button>' : '';
  }
  if (PLX.panel) plxPanelDraw();
}
// Parents ranking worse: the newest rank snapshot against the stored week before it (bsr-audit.js bsrMove, the noise rule included).
function plxWorse(rows) {
  if (typeof BSR === 'undefined' || typeof bsrMove !== 'function' || typeof allWeeks !== 'function') return null;
  const weeks = allWeeks();
  if (weeks.length < 2) return null;
  const a = weeks[weeks.length - 1], b = weeks[weeks.length - 2];
  let n = 0, any = false;
  rows.forEach(r => {
    const ea = ((BSR[r.brand] || {})[a] || {})[r.parent], eb = ((BSR[r.brand] || {})[b] || {})[r.parent];
    if (!ea || !eb) return;
    any = true;
    const sub = ea.sub > 0 && eb.sub > 0;
    if (bsrMove(sub ? ea.sub : ea.rank, sub ? eb.sub : eb.rank, sub ? 'sub' : 'main') === 'worse') n++;
  });
  return any ? n : null;
}

/* ----- one parent: the side panel ----- */
const plxRowOf = key => ((typeof PL_RENDER !== 'undefined' && PL_RENDER.rows) || []).find(r => r.brand + '|' + r.parent === key)
  || ((PLX.lastAll || []).find(r => r.brand + '|' + r.parent === key)) || null;
// The menu bar's height: the sticky toolbar and the panel start under it.
function plxTop() {
  try {
    const side = document.querySelector('.side');
    const top = side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0;
    const pane = plxEl('panePlaudit');
    if (pane && pane.style) pane.style.setProperty('--plx-top', top + 'px');
  } catch (e) { /* no layout */ }
}
function plxPanelOpen(key) {
  PLX.panel = key;
  plxTop();
  document.querySelectorAll('#plTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
  document.querySelectorAll(`#plTable tr[data-pl-row="${CSS.escape(key)}"]`).forEach(tr => tr.classList.add('is-open'));
  plxPanelDraw();
  const x = plxEl('plxPanel') && plxEl('plxPanel').querySelector && plxEl('plxPanel').querySelector('[data-plx="close"]');
  if (x && x.focus) x.focus();
}
function plxPanelClose() {
  const was = PLX.panel;
  PLX.panel = '';
  if (PLX.chart) { try { PLX.chart.dispose(); } catch (e) { /* gone */ } PLX.chart = null; }
  const box = plxEl('plxPanel');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  document.querySelectorAll('#plTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
  const tr = was && document.querySelector(`#plTable tr[data-pl-row="${CSS.escape(was)}"]`);
  if (tr && tr.focus) tr.focus();
}
// The rank as Amazon writes it, with its move since the stored week before: "#3,100 in Tablecloths ▲".
function plxRank(brand, parent) {
  if (typeof BSR === 'undefined' || typeof allWeeks !== 'function') return '';
  const weeks = allWeeks();
  const a = weeks[weeks.length - 1], b = weeks[weeks.length - 2];
  const ea = ((BSR[brand] || {})[a] || {})[parent], eb = b ? ((BSR[brand] || {})[b] || {})[parent] : null;
  if (!ea) return '<span class="muted">No rank in the latest snapshot</span>';
  const sub = ea.sub > 0;
  const now = sub ? ea.sub : ea.rank, was = eb ? (sub ? eb.sub : eb.rank) : 0;
  const mv = was > 0 && typeof bsrMove === 'function' ? bsrMove(now, was, sub ? 'sub' : 'main') : null;
  const arrow = mv === 'better' ? '<span class="plx-d is-up" title="Lower rank number = better on Amazon">▲</span>' : mv === 'worse' ? '<span class="plx-d is-down" title="Lower rank number = better on Amazon">▼</span>' : '';
  return `<b>#${PLX_NUM.format(now)}</b> in ${plxEsc((sub ? ea.subCat : ea.cat) || 'its category')} ${arrow}`
    + (sub && ea.rank ? `<small class="muted">#${PLX_NUM.format(ea.rank)} in ${plxEsc(ea.cat || '')}</small>` : '');
}
// The weeks of the chart: the 6-week average's weeks (last week is one of them), oldest first: sales and ad spend of the parent.
function plxChartData(row) {
  const info = PLX.info || {};
  const byW = ((info.weekly || {})[row.brand + '|' + row.parent]) || {};
  const weeks = [...new Set((info.avgWeeks || []).concat(info.lastWeek ? [info.lastWeek] : []))].sort();
  return weeks.map(w => ({ w, label: typeof wLabel === 'function' ? wLabel(w) : w, sales: (byW[w] || {}).rev || 0, spend: (byW[w] || {}).spend == null ? null : byW[w].spend, last: w === info.lastWeek }));
}
function plxPanelDraw() {
  const box = plxEl('plxPanel');
  const row = plxRowOf(PLX.panel);
  if (!box || !row) return;
  const info = PLX.info || {};
  const kids = ((typeof HEALTH !== 'undefined' && HEALTH[row.brand] && HEALTH[row.brand].rows) || []).filter(r => (r.parent || r.asin || r.sku) === row.parent);
  const wk = info.lastWeek;
  const cell = asin => (typeof WEEKLY !== 'undefined' && WEEKLY.rows[asin] && WEEKLY.rows[asin].weeks ? WEEKLY.rows[asin].weeks[wk] : null) || {};
  const kidRows = kids.map(k => { const c = cell(k.asin); return `<tr><td><span class="plx-fn">${plxEsc([k.color, k.size].filter(Boolean).join(' · ') || k.sku)}</span><small>${plxEsc(k.sku || k.asin)}</small></td>`
    + `<td class="num">${plxMoney(c.rev || 0)}</td><td class="num">${k.qty == null ? '—' : PLX_NUM.format(k.qty)}</td><td class="num">${c.spend == null ? '<span class="muted">—</span>' : plxMoney(c.spend)}</td></tr>`; }).join('');
  // stock and days of cover: the Forecast's when it is loaded, else this page's (last week's rate)
  let cover = '';
  try {
    const f = typeof FO !== 'undefined' && FO.data && typeof foFor === 'function' ? foFor(row.brand) : null;
    const fam = f && f.ok ? (f.fams || []).find(x => x.parent === row.parent) : null;
    if (fam && fam.cover && fam.cover.likely != null) cover = `about ${PLX_NUM.format(fam.cover.likely)} days of cover (Forecast)`;
  } catch (e) { cover = ''; }
  if (!cover) { const d = plxDays(row); cover = d == null ? 'days of cover not known (no sales last week)' : `about ${Math.round(d)} days of cover at last week's rate`; }
  const card = plxCardOf(row);
  const task = typeof tkBtnHtml === 'function' ? tkBtnHtml({ src: 'plr', brand: row.brand, key: row.brand + '|' + row.parent, parent: row.parent, name: row.title || row.parent, problem: `${row.action}: ${row.why || ''}`, kind: 'plr', ref: 'plr|' + row.brand + '|' + row.parent, pick: PLX_PICK[row.action] || 'other' }, 'plx-btn', '+ Task') : '';
  box.innerHTML = `<header class="plx-ph">${row.img ? `<img src="${plxEsc(typeof plThumb === 'function' ? plThumb(row.img) : row.img)}" alt="" class="plx-img">` : '<div class="plx-img plx-noimg">no photo</div>'}`
    + `<div class="plx-ph-t"><h2>${plxEsc(row.title || row.parent)}</h2><p>${plxEsc(typeof BRAND_NAME !== 'undefined' ? BRAND_NAME[row.brand] || row.brand : row.brand)} · ${plxEsc(row.parent)}</p></div>`
    + `<button type="button" class="plx-x" data-plx="close" aria-label="Close (Esc)">✕</button></header>`
    + `<div class="plx-pb"><p class="plx-act">${typeof PL_ACT_TAG !== 'undefined' && PL_ACT_TAG[row.action] ? PL_ACT_TAG[row.action] : plxEsc(row.action)} ${card ? `<span class="muted">${card.e}</span>` : ''} ${plxEsc(row.why || '')}</p>` + (row.al ? `<p class="plx-act plx-alline">📉 Sales Alerts: <b>${plxEsc(plxAlTxt(row.al))}</b> — sales down ${Math.round(row.al.drop)}% from ${plxEsc(row.al.from)} to ${plxEsc(row.al.to)}</p>` : '')
    + `<div class="plx-btns">${task}<button type="button" class="ghost plx-btn" data-plx="card">All figures</button></div>`
    + `<h3 class="plx-h3">The last 6 weeks</h3><div class="plx-chart" id="plxChart" role="img" aria-label="Weekly sales (bars) and ad spend (line), last week highlighted"></div>`
    + `<div class="plx-grid"><div><h3 class="plx-h3">Stock</h3><p><b>${row.stock == null ? '—' : PLX_NUM.format(row.stock)}</b> at Amazon · ${plxEsc(cover)}</p></div>`
    + `<div><h3 class="plx-h3">Rank</h3><p class="plx-rank">${plxRank(row.brand, row.parent)}</p></div></div>`
    + `<h3 class="plx-h3">Children — last week</h3>${kids.length ? `<div class="plx-tw"><table class="plx-kids"><thead><tr><th scope="col">Size / SKU</th><th scope="col" class="num">Sales</th><th scope="col" class="num">Stock</th><th scope="col" class="num">Ad spend</th></tr></thead><tbody>${kidRows}</tbody></table></div>` : '<p class="muted">No children in Listing Health.</p>'}`
    + `<div class="plx-btns"><button type="button" class="ghost plx-btn" data-plx-go="health">Open in Listing Health</button><button type="button" class="ghost plx-btn" data-plx-go="bsr">BSR Audit</button><button type="button" class="ghost plx-btn" data-plx-go="salert">Sales Alerts</button></div></div>`;
  box.hidden = false;
  plxChart(row);
}
function plxChart(row) {
  const el = plxEl('plxChart');
  if (!el) return;
  const pts = plxChartData(row);
  const plain = () => {
    const max = Math.max(1, ...pts.map(p => p.sales));
    el.innerHTML = `<ol class="plx-plain">${pts.map(p => `<li class="${p.last ? 'is-last' : ''}"><span>${plxEsc(p.label)}</span><i style="width:${Math.round(p.sales / max * 100)}%"></i><b>${plxMoney(p.sales)}</b></li>`).join('')}</ol>`;
  };
  const load = typeof sdcLoadCharts === 'function' ? sdcLoadCharts() : Promise.resolve(!!(typeof window !== 'undefined' && window.echarts));
  Promise.resolve(load).then(ok => {
    if (!ok || typeof window === 'undefined' || !window.echarts || !el.isConnected || PLX.panel !== row.brand + '|' + row.parent) { if (el.isConnected !== false && !el.firstChild) plain(); return; }
    const css = n => getComputedStyle(plxEl('plxPanel') || document.documentElement).getPropertyValue(n).trim();
    const c = { ink: css('--ink') || '#1d1d1f', muted: css('--muted') || '#6e6e73', line: css('--card-line') || '#e6e6eb', card: css('--card') || '#fff', brand: css('--brand') || '#2f6fed', warn: css('--warn') || '#e8590c' };
    try {
      if (PLX.chart) { try { PLX.chart.dispose(); } catch (e) { /* gone */ } }
      el.innerHTML = '';
      const ch = PLX.chart = window.echarts.init(el, null, { renderer: 'svg' });
      ch.setOption({
        animation: plxFx(), grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
        legend: { top: 0, data: ['Sales', 'Ad spend'], textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
        tooltip: { trigger: 'axis', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 }, valueFormatter: v => (v == null ? '—' : plxMoney(v)) },
        xAxis: { type: 'category', data: pts.map(p => p.label), axisLabel: { color: c.muted, fontSize: 10 }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: c.muted, fontSize: 10, formatter: v => plxMoney(v) }, splitLine: { lineStyle: { color: c.line } } },
        series: [
          { type: 'bar', name: 'Sales', data: pts.map(p => ({ value: p.sales, itemStyle: { color: c.brand, opacity: p.last ? 1 : 0.38, borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 26 },
          { type: 'line', name: 'Ad spend', data: pts.map(p => p.spend), connectNulls: false, symbolSize: 6, lineStyle: { color: c.warn, width: 2 }, itemStyle: { color: c.warn } },
        ],
      });
    } catch (e) { plain(); }
  });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const on = s => (e.target && e.target.closest ? e.target.closest(s) : null);
    const panel = plxEl('plxPanel');
    if (PLX.panel && panel && !panel.hidden && !on('#plxPanel') && !on('#plTable tr[data-pl-row]') && !on('#tkF, .tk-dlg, [data-tk-new], #plCardModal')) plxPanelClose();
    if (!on('#panePlaudit')) return;
    const b = on('[data-plx], [data-plx-card], [data-plx-go]');
    if (!b || on('[data-tk-new]')) return;
    const d = b.dataset;
    if (d.plx === 'more') { PLX.all = true; return renderPlaudit(); }
    if (d.plx === 'fewer') { PLX.all = false; return renderPlaudit(); }
    if (d.plx === 'clear') { PLX.card = ''; return renderPlaudit(); }
    if (d.plx === 'close') return plxPanelClose();
    if (d.plx === 'card') { const row = plxRowOf(PLX.panel); if (row && typeof plCardOpen === 'function') plCardOpen(row.parent); return undefined; }
    if (d.plxCard) { PLX.card = PLX.card === d.plxCard ? '' : d.plxCard; return renderPlaudit(); }
    if (d.plxGo) {
      const row = plxRowOf(PLX.panel);
      if (!row) return undefined;
      if (d.plxGo === 'salert') { if (typeof AL !== 'undefined') AL.brand = row.brand; if (typeof showTab === 'function') showTab('salert'); return undefined; }
      if (d.plxGo === 'bsr') { if (typeof BSX !== 'undefined') BSX.q = row.title || row.parent; if (typeof showTab === 'function') showTab('bsr'); return undefined; }
      if (typeof showTab === 'function') showTab('health');
      setTimeout(() => { if (typeof hFocusOpen === 'function') hFocusOpen(row.brand, row.parent); }, 300);
    }
    return undefined;
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el && el.id === 'plWeek') { PLX.week = el.value || ''; PLX.card = ''; if (typeof renderPlaudit === 'function') renderPlaudit(); }
  });
  // Esc closes the panel — unless the parent card or a task form is open over it (that closes first). Capture: before their handlers.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !PLX.panel) return;
    const card = plxEl('plCardModal');
    if (card && !card.classList.contains('hide')) return;
    if (typeof TK !== 'undefined' && TK.form) return;
    plxPanelClose();
  }, true);
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (PLX.chart) { try { PLX.chart.resize(); } catch (e) { /* gone */ } } });
}
