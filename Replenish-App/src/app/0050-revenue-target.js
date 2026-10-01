/* ================= REVENUE TARGET (planning only) =================
 * "I intend to do $8,000 from this article next month — how many units is that?"
 *
 * The other direction from everything else in this app: the forecast asks what the SKUs WILL sell,
 * this asks what Ravi has DECIDED to sell and works the units backwards from it. The two must not be
 * confused, so the targets live in their own document (repl/revtarget) and nothing outside this tab
 * reads them — the requirement, the lanes, Req. Qty and Create PO all still run off the forecast.
 *
 * Revenue → units needs a price. The one used is the REALISED ASP (L90 $ ÷ L90 units), i.e. what the
 * article actually fetched after discounts, not a list price nobody sold at.
 */
let REV_TGT = {}, REV_TOT = {}, TGT_LOADED = false, TG_OPEN = new Set();
const tgKey = (brand, sub, mk) => brand + '|' + String(sub).trim().toUpperCase() + '|' + mk;
// The month target is stored against the BRAND PICK, not a brand — "both brands" is its own plan,
// not the sum of two. Switching the picker therefore shows a different target, which is the truth.
const tgTotKey = (pick, mk) => pick + '|' + mk;
const tgMoney = n => (n == null || !isFinite(n)) ? '—' : '$' + nf(Math.round(n));

async function loadRevTgt() {
  if (TGT_LOADED) return;
  try {
    const d = await getDoc(doc(db, 'repl', 'revtarget'));
    const x = d.exists() ? d.data() : {};
    REV_TGT = x.map || {};        // per-article OVERRIDES
    REV_TOT = x.total || {};      // the whole-month figure the rest is shared out from
  } catch (e) { REV_TGT = {}; REV_TOT = {}; }
  TGT_LOADED = true;
}

// One entry per article, per brand. Stopped SKUs are left out of the pool AND the split — you cannot
// plan revenue through something that is not being reordered, and counting its history would inflate
// the article's ASP with a price that is no longer on sale.
function tgArticles(brands) {
  const by = {};
  brands.forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    if (skuOutOfScope(r)) return;
    const sub = String(r.subcat || '').trim();
    if (!sub) return;                                     // no article to hang a target on
    const k = b + '|' + sub;
    const a = by[k] || (by[k] = { brand: b, sub, gk: k, skus: [], u90: 0, amt90: 0, live: 0, stopped: 0 });
    const st = isStopped(r), u = Number(r.last90) || 0, m = Number(r.l90amt) || 0;
    if (st) { a.stopped++; return; }
    a.skus.push({ sku: r.sku, u, m });
    a.u90 += u; a.amt90 += m; a.live++;
  }));
  return Object.values(by).sort((x, y) => x.sub.localeCompare(y.sub) || x.brand.localeCompare(y.brand));
}

// Units for a target. Per SKU it is target × (that SKU's L90 units ÷ the article's L90 revenue) —
// algebraically the same as "share the money by revenue, then divide each share by that SKU's own
// price", but without dividing by a tiny per-SKU amount, which is where that form falls apart.
// The article total is the SUM OF THE ROUNDED SKU numbers, not the unrounded total rounded: a
// breakdown that does not add up to its own total is exactly the bug the cover buckets had.
function tgSplit(a, target) {
  if (!(target > 0) || !(a.amt90 > 0)) return { rows: [], units: 0 };
  const rows = a.skus.map(s => ({ ...s, q: Math.round(target * s.u / a.amt90) })).filter(s => s.q > 0);
  rows.sort((x, y) => y.q - x.q || String(x.sku).localeCompare(String(y.sku)));
  return { rows, units: rows.reduce((n, s) => n + s.q, 0) };
}

// Share a pool of money out by weight, with largest-remainder rounding so the pieces add back to
// EXACTLY the pool. Plain rounding leaves a few dollars unaccounted for across a few hundred
// articles, and a split whose parts do not sum to the whole is the cover-bucket bug in a new costume.
function tgAllocate(weights, pool) {
  const base = weights.reduce((s, w) => s + w, 0);
  if (!(pool > 0) || !(base > 0)) return weights.map(() => 0);
  const exact = weights.map(w => pool * w / base);
  const out = exact.map(v => Math.floor(v));
  let left = Math.round(pool) - out.reduce((s, n) => s + n, 0);
  const order = exact.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((x, y) => y.f - x.f);
  for (let k = 0; left > 0 && order.length; k++, left--) out[order[k % order.length].i]++;
  return out;
}

// THE one calculation. Both the table and the export go through here — two copies of this would
// drift, and the export is the half nobody checks until a factory has already made the wrong number.
//
// Month target → shared across articles by their CURRENT revenue share (L90 $). An article you have
// typed a figure into is FIXED at that figure and drops out of the sharing; what is left of the
// month target is then re-shared among the rest. So overriding one article moves the others, which
// is the whole point of a month target — the total stays what you said it was.
//
// NOTE: computed over EVERY article, before any filter. Filtering is a way of looking at the plan,
// never a way of changing it — the top-seller maths had exactly this bug once.
function tgPlan(brands, pick, mk) {
  const arts = tgArticles(brands);
  const overall = REV_TOT[tgTotKey(pick, mk)];
  const ovrOf = a => REV_TGT[tgKey(a.brand, a.sub, mk)];
  // An override of 0 is a decision ("nothing from this article"), so `!= null` is the test, not `> 0`.
  const fixedArts = arts.filter(a => ovrOf(a) != null);
  const autoArts = arts.filter(a => ovrOf(a) == null);
  const fixed = fixedArts.reduce((s, a) => s + ovrOf(a), 0);
  const hasTotal = overall != null && overall >= 0;
  const pool = hasTotal ? Math.max(0, overall - fixed) : null;
  const alloc = hasTotal ? tgAllocate(autoArts.map(a => a.amt90), pool) : [];
  const autoBy = {};
  autoArts.forEach((a, i) => { autoBy[a.brand + '|' + a.sub] = hasTotal ? alloc[i] : null; });

  const totalAmt90 = arts.reduce((s, a) => s + a.amt90, 0);
  const rows = arts.map(a => {
    const ovr = ovrOf(a), auto = autoBy[a.brand + '|' + a.sub];
    const target = ovr != null ? ovr : auto;
    return { a, key: tgKey(a.brand, a.sub, mk), ovr, auto, target,
      asp: a.u90 > 0 ? a.amt90 / a.u90 : null,
      share: totalAmt90 > 0 ? a.amt90 / totalAmt90 : 0,
      split: tgSplit(a, target) };
  });
  // Biggest first — the plan is read top-down and the articles carrying the money are the ones worth
  // arguing about. Before a month target exists every target is null, so it falls through to L90 $,
  // which is the same order the split will produce anyway. Sorted HERE, not in the render, so the
  // export comes out in the order it was reviewed in.
  rows.sort((x, y) => (y.target || 0) - (x.target || 0)
    || y.a.amt90 - x.a.amt90
    || x.a.sub.localeCompare(y.a.sub));
  return { rows, overall, hasTotal, fixed, pool, nFixed: fixedArts.length,
    over: hasTotal && fixed > overall };
}

async function ensureTarget() {
  $('tgMsg').textContent = 'Loading…';
  await ensureReplData();
  if (!PROD_LOADED) await loadProd();            // status overrides decide which SKUs are stopped
  await loadRevTgt();
  if (!FC_PLAN.length) FC_PLAN = buildFcPlan([...new Set(['SP', 'CPC'].flatMap(b => (REPL[b] && REPL[b].recCols) || []))]);
  const sel = $('tgMonth'), cur = sel.value;
  sel.innerHTML = FC_PLAN.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  if (cur && FC_PLAN.some(p => p.key === cur)) sel.value = cur;
  $('tgMsg').textContent = '';
  renderTarget();
}

function renderTarget() {
  const pick = $('tgBrand').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => REPL[b]);
  const mk = $('tgMonth').value;
  const plan = FC_PLAN.find(p => p.key === mk);
  if (!brands.length || !plan) {
    $('tgTable').innerHTML = '';
    $('tgMsg').innerHTML = ACCESS_ERR
      ? `<span class="err">${esc(ACCESS_ERR)}</span>`
      : 'No snapshot yet — hit “Refresh from sheet” on the Replenishment tab first.';
    return;
  }
  const P = tgPlan(brands, pick, mk);
  // The box is only refilled when it is not being typed in — otherwise a re-render triggered by an
  // article edit would rewrite the total under the cursor.
  const tot = $('tgTotal');
  if (document.activeElement !== tot) tot.value = P.hasTotal ? P.overall : '';

  const ft = $('tgFilter').value.trim().toLowerCase();
  const shown = ft ? P.rows.filter(x => x.a.sub.toLowerCase().includes(ft)) : P.rows;

  const head = '<thead><tr>'
    + '<th style="width:26px"></th><th class="frz">Article</th><th>Brand</th>'
    + '<th class="num" title="SKUs still being reordered. Stopped ones are left out of the whole calculation.">SKUs</th>'
    + '<th class="num">L90 units</th><th class="num">L90 $</th>'
    + '<th class="num" title="Realised average selling price — L90 revenue ÷ L90 units. What the article actually fetched, after discounts.">ASP</th>'
    + '<th class="num" title="This article’s share of the current L90 revenue — the weight the month target is shared out by.">Share</th>'
    + '<th class="num" title="What the auto split gives this article out of the month target. An article you have fixed by hand is not taking from that pool at all, so it shows a dash.">Auto $</th>'
    + `<th class="num" title="What this article is planned to do in ${esc(plan.label)}. Blank = the Auto figure. Type to fix it; what is left of the month target is re-shared among the others.">Target $</th>`
    + '<th class="num" title="Target ÷ ASP, worked out SKU by SKU and added up.">Units needed</th>'
    + '<th class="num" title="How much bigger the target is than the article’s own run rate for this month. 2.0× means twice what it is doing now.">vs run rate</th>'
    + '</tr></thead>';

  const body = shown.map(x => {
    const a = x.a, key = x.key, open = TG_OPEN.has(key);
    // What the article does anyway this month, at its own 90-day pace. plan.days is the days LEFT in
    // the current month and the whole month for later ones, so a part-worn month is not overstated.
    const rrUnits = a.u90 / 90 * plan.days;
    const mult = (x.split.units > 0 && rrUnits > 0) ? (x.split.units / rrUnits) : null;
    const main = `<tr class="tgrow" data-key="${esc(key)}">`
      + `<td class="tgexp" style="text-align:center;cursor:pointer" title="Show the SKU split">${open ? '&#9662;' : '&#9656;'}</td>`
      + `<td class="frz tgexp" style="font-weight:600;cursor:pointer">${esc(a.sub)}`
        + `${x.ovr != null ? ' <span class="amber" title="Fixed by hand — the month target is shared out among the others.">set</span>' : ''}</td>`
      + `<td>${esc(BRAND_NAME[a.brand] || a.brand)}</td>`
      + `<td class="num">${nf(a.live)}${a.stopped ? `<span class="muted" title="${nf(a.stopped)} stopped SKU(s) excluded"> +${nf(a.stopped)}</span>` : ''}</td>`
      + `<td class="num">${nf(a.u90)}</td><td class="num">${tgMoney(a.amt90)}</td>`
      + `<td class="num">${x.asp == null ? '<span class="muted">—</span>' : '$' + x.asp.toFixed(2)}</td>`
      + `<td class="num muted">${(x.share * 100).toFixed(1)}%</td>`
      + `<td class="num muted">${x.auto == null ? '—' : tgMoney(x.auto)}</td>`
      + `<td class="num"><input class="tgIn" type="number" min="0" step="1" inputmode="numeric"`
        + ` data-key="${esc(key)}" placeholder="${x.auto == null ? '' : x.auto}"`
        + ` value="${x.ovr == null ? '' : x.ovr}"></td>`
      + `<td class="num" style="font-weight:700">${x.split.units ? nf(x.split.units)
          : (x.target > 0 ? '<span class="muted" title="No 90-day sales history for this article, so there is no price to work units out from.">no ASP</span>' : '<span class="muted">—</span>')}</td>`
      + `<td class="num">${mult == null ? '<span class="muted">—</span>'
          : `<span${mult >= 2 ? ' style="color:var(--bad);font-weight:700"' : ''}>${mult.toFixed(1)}×</span>`}</td>`
      + '</tr>';
    if (!open) return main;
    // The split, shown under its article rather than in a modal — the point of opening it is to read
    // it against the numbers on the row above.
    const sub = x.split.rows.length
      ? x.split.rows.map(s => `<tr class="tgsub"><td></td><td class="frz" style="padding-left:18px;font-family:ui-monospace,monospace">${esc(s.sku)}</td>`
          + `<td></td><td></td><td class="num">${nf(s.u)}</td><td class="num">${tgMoney(s.m)}</td>`
          + `<td class="num">${s.u > 0 ? '$' + (s.m / s.u).toFixed(2) : '<span class="muted">—</span>'}</td>`
          + `<td></td><td></td><td></td>`
          + `<td class="num" style="font-weight:600">${nf(s.q)}</td><td></td></tr>`).join('')
      : `<tr class="tgsub"><td></td><td colspan="11" class="muted" style="padding-left:18px">`
          + `${x.target > 0 ? 'Nothing to split — this article has no 90-day sales to share the target out by.'
             : 'No money reaches this article yet — set a month target, or type one in here.'}</td></tr>`;
    return main + sub;
  }).join('');

  $('tgTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="12" class="muted" style="padding:14px">No articles match.</td></tr>') + '</tbody>';

  // The summary is about the WHOLE plan, never the filtered view — a filter must not look like a
  // smaller target.
  const planned = P.rows.reduce((s, x) => s + (x.target > 0 ? x.target : 0), 0);
  const units = P.rows.reduce((s, x) => s + x.split.units, 0);
  const noAsp = P.rows.filter(x => x.target > 0 && !x.split.units);
  $('tgTotSum').innerHTML = !P.hasTotal
    ? 'Type a month target and it will be shared across the articles by their current revenue share.'
    : `${tgMoney(P.overall)} for ${esc(plan.label)} · ${nf(P.nFixed)} article(s) fixed at ${tgMoney(P.fixed)}`
      + ` · ${tgMoney(P.pool)} shared across the rest`;
  $('tgMsg').innerHTML = `${nf(P.rows.length)} article(s)${ft ? ` · showing ${nf(shown.length)}` : ''}`
    + ` · planned ${tgMoney(planned)} → <b>${nf(units)} units</b>`
    + (P.over ? ` · <span class="err">the articles you fixed already come to ${tgMoney(P.fixed)}, more than the ${tgMoney(P.overall)} month target — the rest are getting nothing</span>` : '')
    + (noAsp.length ? ` · <span class="err">${nf(noAsp.length)} article(s) have money but no 90-day sales, so no units can be worked out</span>` : '')
    + (plan.partial ? ' · this month is costed on the days still LEFT in it' : '')
    + ' · saves as you leave the box';
}

$('tgTable').addEventListener('click', e => {
  const row = e.target.closest('.tgrow'); if (!row) return;
  // The whole row toggles, EXCEPT the cell holding the target box — missing the input by a few pixels
  // should not collapse the split you are reading.
  const td = e.target.closest('td'); if (td && td.querySelector('.tgIn')) return;
  const k = row.dataset.key;
  if (TG_OPEN.has(k)) TG_OPEN.delete(k); else TG_OPEN.add(k);
  renderTarget();
});
$('tgTable').addEventListener('change', async e => {
  const inp = e.target.closest('.tgIn'); if (!inp) return;
  const key = inp.dataset.key, raw = inp.value.trim();
  if (raw !== '' && !/^\d+(\.\d+)?$/.test(raw)) {
    $('tgMsg').textContent = `"${inp.value}" is not an amount — digits only, or leave it blank.`;
    inp.value = REV_TGT[key] == null ? '' : REV_TGT[key];
    return;
  }
  const n = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
  if (n == null) delete REV_TGT[key]; else REV_TGT[key] = n;
  renderTarget();
  try { await setDoc(doc(db, 'repl', 'revtarget'), { map: { [key]: n }, by: ME.email, at: serverTimestamp() }, { merge: true }); }
  catch (err) { $('tgMsg').textContent = 'Could not save the target: ' + (err.message || err); }
});
// The month target. Every article without an override moves when this changes, so the table is
// redrawn — but only after the value has left the box, so nothing is rewritten mid-type.
$('tgTotal').addEventListener('change', async () => {
  const pick = $('tgBrand').value, mk = $('tgMonth').value, key = tgTotKey(pick, mk);
  const raw = $('tgTotal').value.trim();
  if (raw !== '' && !/^\d+(\.\d+)?$/.test(raw)) {
    $('tgMsg').textContent = `"${$('tgTotal').value}" is not an amount — digits only, or leave it blank.`;
    $('tgTotal').value = REV_TOT[key] == null ? '' : REV_TOT[key];
    return;
  }
  const n = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
  if (n == null) delete REV_TOT[key]; else REV_TOT[key] = n;
  renderTarget();
  try { await setDoc(doc(db, 'repl', 'revtarget'), { total: { [key]: n }, by: ME.email, at: serverTimestamp() }, { merge: true }); }
  catch (err) { $('tgMsg').textContent = 'Could not save the month target: ' + (err.message || err); }
});
$('tgBrand').addEventListener('change', renderTarget);
$('tgMonth').addEventListener('change', renderTarget);
let TG_FT = null;
$('tgFilter').addEventListener('input', () => { clearTimeout(TG_FT); TG_FT = setTimeout(renderTarget, 250); });

// Which months actually have something planned. A month counts if it has a month target of its own,
// or an article override for one of the brands on screen — an override alone is a plan.
function tgPlannedMonths(brands, pick) {
  return FC_PLAN.filter(p => REV_TOT[tgTotKey(pick, p.key)] != null
    || Object.keys(REV_TGT).some(k => REV_TGT[k] != null && k.endsWith('|' + p.key)
        && brands.includes(k.slice(0, k.indexOf('|')))));
}

// SKU-level, because that is the form the number is actually used in — nobody can make an article
// total. Every row comes from tgPlan, the same call the table draws from, and the filter box is
// ignored: the export is the plan, not the current view of it.
$('tgCsv').onclick = () => {
  const pick = $('tgBrand').value, mk = $('tgMonth').value, scope = $('tgScope').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => REPL[b]);
  if (!brands.length) return;
  const months = scope === 'one'
    ? FC_PLAN.filter(p => p.key === mk)
    : tgPlannedMonths(brands, pick);
  if (!months.length) {
    $('tgMsg').textContent = scope === 'one'
      ? 'Nothing to export for this month.'
      : 'Nothing to export — no month has a target or an override yet.';
    return;
  }
  const plans = months.map(p => ({ p, P: tgPlan(brands, pick, p.key) }));

  if (scope === 'wide') {
    // One row per SKU, one column per month — the shape you hand to production. A SKU that appears
    // in only some months is still one row; the months it is not planned for are left BLANK rather
    // than zero, because "not planned" and "planned as nothing" are different answers.
    const bySku = new Map();
    plans.forEach(({ p, P }) => P.rows.forEach(x => x.split.rows.forEach(s => {
      const e = bySku.get(s.sku) || { sku: s.sku, brand: BRAND_NAME[x.a.brand] || x.a.brand,
        art: x.a.sub, asp: s.u > 0 ? (s.m / s.u).toFixed(2) : '', q: {} };
      e.q[p.key] = (e.q[p.key] || 0) + s.q;
      bySku.set(s.sku, e);
    })));
    const out = [...bySku.values()]
      .map(e => ({ e, tot: months.reduce((n, p) => n + (e.q[p.key] || 0), 0) }))
      .sort((a, b) => b.tot - a.tot || String(a.e.sku).localeCompare(String(b.e.sku)))
      .map(({ e, tot }) => [e.sku, e.brand, e.art, e.asp,
        ...months.map(p => e.q[p.key] == null ? '' : e.q[p.key]), tot]);
    if (!out.length) { $('tgMsg').textContent = 'Nothing to export — no units come out of this plan.'; return; }
    csvDownload('revenue-target-' + months[0].key + '-to-' + months[months.length - 1].key,
      ['SKU', 'Brand', 'Article', 'SKU ASP', ...months.map(p => p.label), 'Total'], out);
    $('tgMsg').textContent = `Exported ${nf(out.length)} SKU(s) across ${months.length} month(s).`;
    return;
  }

  const out = [];
  plans.forEach(({ p, P }) => P.rows.forEach(x => x.split.rows.forEach(s => out.push([
    p.label, BRAND_NAME[x.a.brand] || x.a.brand, x.a.sub, s.sku,
    x.ovr != null ? 'override' : 'auto', Math.round(x.target),
    x.asp == null ? '' : x.asp.toFixed(2), s.u > 0 ? (s.m / s.u).toFixed(2) : '', s.u, s.q]))));
  if (!out.length) { $('tgMsg').textContent = 'Nothing to export — no month target or article target set yet.'; return; }
  csvDownload('revenue-target-' + (scope === 'one' ? mk : months[0].key + '-to-' + months[months.length - 1].key),
    ['Month', 'Brand', 'Article', 'SKU', 'Article target from', 'Article target $', 'Article ASP',
      'SKU ASP', 'SKU L90 units', 'Qty'], out);
  $('tgMsg').textContent = `Exported ${nf(out.length)} row(s) across ${months.length} month(s).`;
};

$('tgClear').onclick = async () => {
  const pick = $('tgBrand').value, mk = $('tgMonth').value;
  const plan = FC_PLAN.find(p => p.key === mk), lbl = plan ? plan.label : mk;
  const keys = Object.keys(REV_TGT).filter(k => k.endsWith('|' + mk) && REV_TGT[k] != null);
  const tk = tgTotKey(pick, mk), hasTot = REV_TOT[tk] != null;
  if (!keys.length && !hasTot) { $('tgMsg').textContent = `Nothing to clear for ${lbl}.`; return; }
  const what = [hasTot ? `the ${lbl} month target` : '', keys.length ? `${keys.length} article override(s)` : '']
    .filter(Boolean).join(' and ');
  if (!confirm(`Remove ${what}?`)) return;
  const patch = {};
  keys.forEach(k => { patch[k] = null; delete REV_TGT[k]; });
  if (hasTot) delete REV_TOT[tk];
  renderTarget();
  try {
    await setDoc(doc(db, 'repl', 'revtarget'),
      { map: patch, total: hasTot ? { [tk]: null } : {}, by: ME.email, at: serverTimestamp() }, { merge: true });
  } catch (err) { $('tgMsg').textContent = 'Could not clear: ' + (err.message || err); }
};

$('rMarket').value = US_ONLY ? '1' : '0';
$('rMarket').addEventListener('change', () => {
  US_ONLY = $('rMarket').value === '1';
  localStorage.setItem('repl_us_only', US_ONLY ? '1' : '0');
  renderRepl();
  if (!$('paneArticle').classList.contains('hide')) renderArticle();
});

/* THE MASTER FILLS WHAT AMAZON LEAVES BLANK (Ravi, 2026-09-26: "replenishment me match nahi ho rha h"). A new listing
 * comes back from Amazon's catalogue with no colour, size or sub-category, while the Master Database has them. Only a
 * BLANK is filled — what Amazon says is kept. The master is read once for this tab when nothing else has read it. */
let REPL_MDB = null, REPL_MDB_BUSY = false;
const replMaster = () => (typeof PTG !== 'undefined' && PTG.mdb) || REPL_MDB;
async function replMasterLoad() {
  if (replMaster() || REPL_MDB_BUSY) return;
  REPL_MDB_BUSY = true;
  try { REPL_MDB = ptList(await ptGet('pt_masterDB')).map(mdbYnFix); } catch (e) { REPL_MDB = []; }
  REPL_MDB_BUSY = false;
  if (REPL_MDB.length) { try { renderRepl(); } catch (e) { /* not on that tab */ } }
}
function replFillFromMaster() {
  const src = replMaster();
  if (!src || !src.length) return 0;
  const by = new Map(src.filter(Boolean).map(m => [String(m.sku || '').trim().toUpperCase(), m]));
  let n = 0;
  ['SP', 'CPC'].forEach(b => ((REPL[b] && REPL[b].rows) || []).forEach(r => {
    const m = r && by.get(String(r.sku || '').trim().toUpperCase()); if (!m) return;
    const blank = v => !String(v == null ? '' : v).trim();
    if (blank(r.color) && m.color) { r.color = m.color; r.fromMaster = true; n++; }
    if (blank(r.size) && m.size) { r.size = m.size; r.fromMaster = true; n++; }
    if (blank(r.subcat) && (m.subtype || m.articleType)) { r.subcat = m.subtype || m.articleType; r.fromMaster = true; n++; }
  }));
  return n;
}
/* NOT DRAWN WHILE NOBODY IS LOOKING (Ravi, 2026-09-27: "Page Unresponsive" moving from Replenishment to Shopify
 * Orders). Six background loads — India stock (cache, then live), the master, the US-listing set, production notes —
 * each ended by redrawing this 4,700-SKU table whether or not it was on screen, and each changed the rows signature,
 * so each was a full walk of the snapshot: seconds apiece, landing one after another on whatever tab was open. Now a
 * hidden table is only marked to redraw, and opening the tab draws it once with everything that has landed. */
let REPL_DIRTY = false;
function renderRepl() {
  if ($('paneRepl') && $('paneRepl').classList.contains('hide')) { REPL_DIRTY = true; return; }
  REPL_DIRTY = false;
  if (!replMaster()) replMasterLoad(); else replFillFromMaster();
  const _t0 = performance.now();   // perf probe — see the "[repl] rendered …ms" console line
  /* NO STANDING NOTICE. India stock is read on every visit, so a line saying it is being read was
   * on screen every visit — and a notice that is always there stops being read. The column says it
   * for itself while it fills, and the figures above it carry the stamp of what was read. */
  const pick = $('rBrand').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => REPL[b]);
  if (!brands.length) {
    $('rKpis').innerHTML = ACCESS_ERR
      ? `<div class="kpi"><div class="kpiname" style="color:var(--bad)">No access to the data</div><div style="margin-top:6px;font-size:13px">${esc(ACCESS_ERR)}</div></div>`
      : '<div class="kpi"><div class="kpiname">No snapshot yet</div><div class="muted" style="margin-top:6px">Hit “Refresh from sheet” to pull the current replenishment plan.</div></div>';
    $('rTable').innerHTML = ''; return;
  }
  fillReplFilters(brands);   // keep the Sub-Category / Color / Status option lists in sync with the data
  // Lazy-load India stock + the manual disc/remark map once; a single re-render after BOTH land.
  if (!INDIA_LOADED || !PROD_LOADED || !INPROD_LOADED || !US_LOADED) {
    const ps = [];
    if (!US_LOADED) ps.push(loadUsSkus());          // which SKUs Amazon lists on the US marketplace
    if (!INDIA_LOADED) ps.push(loadIndiaStock());
    if (!PROD_LOADED) ps.push(loadProd());
    if (!INPROD_LOADED) ps.push(loadInProd());      // Ready Dates drive the sea/air lane decision
    Promise.all(ps).then(() => { if (!$('paneRepl').classList.contains('hide')) renderRepl(); });
  }
  INPROD_READY = inProdReadyMap();
  // Forecast months (+ which "Rec." column feeds each) — built once per render, before the row walk.
  FC_PLAN = buildFcPlan([...new Set(brands.flatMap(b => (REPL[b] && REPL[b].recCols) || []))]);
  // Drop the forecast cache only when something it actually depends on changed: the horizon, a manual
  // projection, or the snapshot itself (row count + its timestamp identify a refresh).
  const fcSig = fcMonths() + '|' + PROJ_VER + '|' + brands.map(b =>
    b + ':' + ((REPL[b].rows || []).length) + ':' + (REPL[b].at ? REPL[b].at.getTime() : 0) + ':' + (REPL[b].mode || 'full')).join(',');
  if (fcSig !== FC_CACHE_SIG) { FC_CACHE = new Map(); FC_CACHE_SIG = fcSig; }
  // Must come AFTER FC_PLAN — its month need-by timestamps are derived from it.
  LANE_CTX = buildLaneCtx();        // rebuilt each render: the lead-time inputs can change any time
  R_PMAP = inProdMap();             // once per render, not once per row
  SUPPLY_COLS = !!$('rSupply').value;
  /* EVERYTHING THE WALK BELOW READS, in one string. A filter is not in it — that is the point. */
  const rowSig = [
    brands.join(','),
    brands.map(b => (REPL[b].rows || []).length + '@' + (REPL[b].at ? REPL[b].at.getTime() : 0) + '@' + (REPL[b].mode || 'full')).join(','),
    fcMonths(), PROJ_VER, R_VER,
    LEAD.prod, LEAD.disp, LEAD.air, LEAD.sea,
    ($('rMarket') || {}).value, ($('rSupply') || {}).value,
    Object.keys(HIDDEN).length,
    INDIA_LOADED ? 'i' + String(INDIA_AT || '') : '-',
    PROD_LOADED ? 'p' : '-',
    /* Not just how many batches are in production — how much is in them. A quantity edited on
       an existing batch changes every supply plan and would not move a count. */
    INPROD_LOADED ? 'n' + Object.keys(R_PMAP || {}).length + '/' 
      + Object.values(R_PMAP || {}).reduce((a, x) => a + (Number(x && x.qty) || 0), 0) : '-',
    US_LOADED ? 'u' + (US_AT ? US_AT.getTime() : 0) : '-',
  ].join('|');
  let rows;
  if (R_ROWS_CACHE.sig === rowSig && R_ROWS_CACHE.rows) {
    rows = R_ROWS_CACHE.rows;
    US_HIDDEN = R_ROWS_CACHE.usHidden;
  } else {
    rows = brands.flatMap(b => (REPL[b].rows || []).map(r => ({ ...r, brand: b })));
    // HIDDEN SKUs LEAVE HERE, before anything counts them.
    //
    // Applied at the one place rows enter the view, so the buckets, the reorder summary, the
    // top-seller maths, Export and Create-PO all agree without any of them knowing this list exists.
    // Filtering later, per feature, is how a SKU ends up hidden in the table and still in the totals.
    rows = dropOutOfScope(rows);
    markTopSellers(rows);
    rows.forEach(r => {
      applyStatus(r);
      r._mode = replMode(r); r._state = stockState(r); r._req = replReq(r); r._ind = replIndiaAlloc(r);
      r._fc = fcFor(r);
      r._lanes = fcLanes(r, r._fc);   // cheap, and depends on the lead-time settings → never cached
      r._sup = supplyPlan(r);         // where each month's shortfall is actually going to come from
    });
    R_ROWS_CACHE = { sig: rowSig, rows, usHidden: US_HIDDEN };
  }
  R_ALL_ROWS = rows;                // before any filter — the top-seller counts are about all of them

  /* ---------- how soon does it run out ----------
   *
   * CUMULATIVE, not banded. "30 days" means everything that runs out within thirty days, which
   * already includes the fifteen-day ones and the shelves that are empty today. That is the
   * question a planner is actually asking — "what must I act on this month" — and exclusive bands
   * would answer a different one, then hide the most urgent SKUs from the widest view.
   *
   * Out of stock reuses the app's existing `_state`, rather than a fresh definition of empty. Two
   * definitions of "out" in one screen is how a SKU ends up urgent in one place and fine in another.
   */
  /* One pass, one bucket per SKU. The counts on the buttons therefore add up to the total, and
   * clicking a button shows exactly the SKUs its number promised. */
  const sold90 = r => (Number(r.last90) || 0) > 0;
  const coverCounts = {};
  rows.forEach(r => { const k = coverBucket(r, sold90); coverCounts[k] = (coverCounts[k] || 0) + 1; });
  const COVER_LABEL = { '': 'All', outsell: 'Out · sold in 90d', outdead: 'Out · no sale 90d',
    '15': '1–15 d', '30': '16–30 d', '45': '31–45 d', '60': '46–60 d', ok: '60 d+' };
  $('rCoverSeg').querySelectorAll('[data-cover]').forEach(b2 => {
    const k = b2.dataset.cover;
    b2.textContent = `${COVER_LABEL[k]} · ${k === '' ? rows.length : (coverCounts[k] || 0)}`;
  });
  if (R_COVER) rows = rows.filter(r => coverBucket(r, sold90) === R_COVER);

  /* The top sellers, and how exposed they are. Counted over every top SKU of the chosen brands, not
   * over the current bucket — the question "how much of what earns the money is about to run out"
   * has to survive whatever else is filtered. */
  const tops = R_ALL_ROWS.filter(r => r._top);
  const topOut = tops.filter(r => r._state === 'out').length;
  const topSoon = tops.filter(r => r._state !== 'out' && r.coverDos != null && Number(r.coverDos) < 60).length;
  $('rTopOnly').classList.toggle('on', R_TOP_ONLY);
  $('rTopOnly').style.background = R_TOP_ONLY ? 'var(--ink,#0f172a)' : '';
  $('rTopOnly').style.color = R_TOP_ONLY ? '#fff' : '';
  /* THE NUMBER, AND NOTHING ELSE. How many are empty and how many are short of cover are both a
   * click away on the buckets above; written out here they were a sentence nobody finished. The
   * tooltip keeps them for whoever wants them. */
  $('rTopNote').textContent = tops.length ? nf(tops.length) + ' SKUs' : '';
  $('rTopNote').title = tops.length
    ? nf(tops.length) + ' SKUs earn 60% of revenue · ' + nf(topOut) + ' empty · '
      + nf(topSoon) + ' under 60 days of cover'
    : '';
  if (R_TOP_ONLY) rows = rows.filter(r => r._top);
  const COVER_NOTE = {
    outsell: 'Empty, and selling — every day costs a sale',
    outdead: 'Empty, and nothing sold in 90 days — a decision, not an emergency',
    '15': 'Still has stock, but gone within a fortnight',
    '30': 'Runs out in the second half of the month',
    '45': 'Runs out 31 to 45 days out',
    '60': 'Runs out 46 to 60 days out',
    ok: 'Over 60 days of cover, or no cover figure',
  };
  $('rCoverNote').textContent = R_COVER ? (COVER_NOTE[R_COVER] || '') : '';

  const need = $('rNeed').value;
  if (need === 'air') rows = rows.filter(r => r._req.air > 0);
  else if (need === 'sea') rows = rows.filter(r => r._req.sea > 0);
  else if (need === 'any') rows = rows.filter(r => r._req.air > 0 || r._req.sea > 0 || r._req.awd > 0);
  else if (need === 'out') rows = rows.filter(r => r._state === 'out');
  /* The ones the AWD column already marks amber: stock in AWD, selling, and FBA short of cover.
   * The rule itself is the backend's — this filter must never invent a second opinion about it. */
  else if (need === 'awdmove') rows = rows.filter(r => !!r.awdTransfer);
  // Every SKU carrying a manually-typed / uploaded projection in ANY month of the horizon (the yellow cells).
  else if (need === 'projman') rows = rows.filter(r => r._fc.some(f => f.manual));

  // Attribute filters (Cat / Sub-Category / Color / Status / Send). Empty value = no constraint.
  // Nothing ticked = no constraint, so each line is the same shape whether one value is chosen or ten.
  // `skip` leaves ONE picker out, which is what its own option list has to be measured against.
  const sendOf = r => (r.stopped ? 'Stopped' : (r.decision || ''));
  const attrOk = (r, skip) => (skip === 'rCat' || msHas('rCat', r.category))
    && (skip === 'rSubcat' || msHas('rSubcat', r.subcat))
    && (skip === 'rColor' || msHas('rColor', r.color))
    && (skip === 'rStatus' || msHas('rStatus', r.status))
    && (skip === 'rSend' || msHas('rSend', sendOf(r)));

  const q = $('rFilter').value.trim().toLowerCase();
  const pool = q
    ? rows.filter(r => ((r.sku || '') + ' ' + (r.asin || '') + ' ' + (r.parent || '') + ' ' + (r.color || '') + ' ' + (r.size || '')).toLowerCase().includes(q))
    : rows;
  rows = pool.filter(r => attrOk(r, ''));

  /* THE PICKERS ONLY OFFER WHAT IS STILL REACHABLE.
   *
   * Search "Rustic Brown" and the Sub-Category list used to go on showing all three hundred, most of
   * which would have returned an empty table — a list of dead ends you have to try one by one.
   *
   * Each list is measured against every OTHER filter but not its own, which is what keeps a
   * multi-select usable: with "Cloth Napkins" ticked, the list must still show the sub-categories
   * you could ADD to it, not just the one already chosen. */
  msRefine('rSubcat', pool.filter(r => attrOk(r, 'rSubcat')).map(r => r.subcat));
  msRefine('rColor', pool.filter(r => attrOk(r, 'rColor')).map(r => r.color));
  msRefine('rStatus', pool.filter(r => attrOk(r, 'rStatus')).map(r => r.status));

  const multi = brands.length > 1;
  // Dynamic monthly "Rec." columns, in the sheet's order (first brand's order, plus any extras).
  const recCols = [...new Set(brands.flatMap(b => REPL[b]?.recCols || []))];

  // Columns mirror the sheet's Inventory tab first (product → supply → monthly Rec. → AWD), then the
  // app's value-add (run-rate + the Air/Sea reorder plan).
  const defs = [
    { k: 'sku', t: 'SKU', frz: 1 },
    { k: 'img', t: 'Image', img: 1 },
  ];
  if (multi) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
  defs.push(
    { k: 'asin', t: 'ASIN', mono: 1 },
    { k: 'parent', t: 'Parent ASIN', mono: 1 },
    { k: 'color', t: 'Color' }, { k: 'size', t: 'Size' },
    { k: 'subcat', t: 'Sub-Category' },
    // India listing status (manual column in the India Stock tab). Discontinue / Use In Mix = stopped:
    // no future projection is added (Air/Sea/AWD Req blank, Send shows "Stopped").
    // Shows the auto-fetched India status as a colour pill (as before). The little ▾ next to it lets you
    // OVERRIDE it manually — e.g. pick Discontinue to stop a listing straight from the app (Discontinue /
    // Use In Mix → stopped, no projection). A manually-set status carries an ✎ mark; pick Auto to clear it.
    { k: 'status', t: 'Status', noTotal: 1,
      cell: r => { const s = (r.status || '').trim();
        const cl = r.stopped ? 'st-stop' : /need/i.test(s) ? 'st-need' : /listed/i.test(s) ? 'st-live' : 'st-other';
        const pill = s ? `<span class="st ${cl}"${r.stopped ? ' title="No future projection"' : ''}>${esc(s)}</span>` : '<span class="muted">—</span>';
        const mark = r._statusManual ? ' <span class="muted" title="Manually set — click ▾ and pick Auto to follow the India status again">✎</span>' : '';
        return `<span style="display:inline-flex;align-items:center;gap:2px">${pill}${mark}<button class="stedit" data-sku="${esc(r.sku)}" title="Override status" style="border:none;background:none;cursor:pointer;color:#94a3b8;font-size:11px;padding:0 2px;line-height:1">▾</button></span>`; } },
    { k: 'totalStock', t: 'Total Stock', num: 1 },
    { k: 'warehouse', t: 'Warehouse', num: 1 },
    { k: 'fulfillable', t: 'Fulfillable', num: 1 },
  );
  recCols.forEach(rc => defs.push({ k: 'rec:' + rc, t: rc, num: 1, map: r => (r.rec && r.rec[rc]) || 0 }));
  defs.push(
    { k: 'inbReceiving', t: 'Inb-Recv', num: 1 },
    // Highlighted amber when the FBA side (warehouse + inb-recv) is low but AWD has stock → transfer AWD→FBA.
    { k: 'awdAvail', t: 'AWD Available', num: 1,
      cell: r => { const v = r.awdAvail || 0;
        if (!r.awdTransfer) return v ? nf(v) : '<span class="muted">—</span>';
        return `<span class="amber" title="FBA stock (warehouse + inb-recv) is running low — transfer these ${nf(v)}u from AWD → FBA (they're already in the US)">⇄ ${nf(v)}</span>`; } },
    { k: 'awdTransit', t: 'AWD Transit', num: 1 },
    { k: 'last30', t: 'L30', num: 1 }, { k: 'last90', t: 'L90', num: 1 },
    { k: 'l90amt', t: 'L90 $', num: 1, money: 1 },
    // ABC/D by average monthly revenue (L90$ ÷ 3); the category decides which average Avg/day uses.
    { k: 'category', t: 'Cat', noTotal: 1,
      cell: r => { const c = r.category || ''; if (!c) return '<span class="muted">—</span>';
        return `<span class="cat cat-${c}" title="Monthly $${(r.monthlyAmt || 0).toLocaleString('en-US')} (higher of last-30-days revenue and the 90-day monthly average) — A ≥3000 · B 1500–3000 · C <1500 · D no 90-day sale">${c}</span>`; } },
    // A/B → max(L30/30, L90/90); C → L90/90; D → whole-year (365d) average from Orders, cell AMBER.
    // The BASIS (which period won) is shown next to the number, with the full breakdown on hover.
    { k: 'avgSale', t: 'Avg/day', num: 1, bold: 1, noTotal: 1,
      cell: r => {
        const v = r.avgSale || 0; if (!v) return '<span class="muted">—</span>';
        const f = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
        const a30 = (r.last30 || 0) / 30, a90 = (r.last90 || 0) / 90;
        let basis, tip;
        if (r.oosYear) {
          /* Ravi, 15 Sep: a SKU out of stock for a long time is rated on its YEAR — the months it actually
           * sold in — because its 30/90-day figures only measure the stockout. */
          basis = 'yr·OOS';
          tip = `Out of stock now, and nothing sold in the last 30 days${r.oosDays != null ? ` (last sale ${nf(r.oosDays)} days ago)` : ''} — its L30/L90 only measure the stockout.`
            + ` Rated on the last 365 days instead: ${nf(r.yrUnits || 0)} units over the ${nf(r.yrMonths || 0)} month(s) it sold in = ${f(v)}/day.`
            + ` (L30/day ${f(a30)} · L90/day ${f(a90)})`;
        }
        else if (r.oosLong && r.inStockDays) {
          basis = 'in-stock';
          tip = `Out of stock now; it last sold ${nf(r.oosDays)} days ago, so of the last 90 days it could sell on about ${nf(r.inStockDays)}.`
            + ` Over those days it ran at ${f(v)}/day (flat L90÷90 would say ${f(a90)}/day).`;
        }
        else if (r.oosThin) { basis = 'thin'; tip = `Out of stock now with too few in-stock days to rate, so the usual figure stands at ${f(v)}/day.`; }
        else if (r.oosLong) { basis = 'yr·OOS'; tip = `Out of stock now — rebuilt from the whole-year history over the months this SKU actually sold in = ${f(v)}/day (L30/day ${f(a30)} · L90/day ${f(a90)}).`; }
        else if (r.category === 'D') { basis = 'yr'; tip = `No sale in 90 days → whole-year history, averaged over the months it actually sold in = ${f(v)}`; }
        else if (r.category === 'C') { basis = '90d'; tip = `Category C → 90-day daily avg (L90÷90) = ${f(v)}`; }
        else { basis = a30 >= a90 ? 'L30' : 'L90'; tip = `L30/day ${f(a30)} · L90/day ${f(a90)} → max = ${basis} = ${f(v)}`; }
        const label = `<span class="basis">${basis}</span>`;
        return r.avgHist ? `<span class="amber" title="${tip}">${f(v)}</span> ${label}` : `<span title="${tip}">${f(v)}</span> ${label}`;
      } },
    // Days of cover of the full pipeline (Total Stock + AWD Avail + AWD Transit) ÷ Avg/day.
    { k: 'coverDos', t: 'Cover (d)', num: 1, noTotal: 1,
      cell: r => { const d = r.coverDos; if (d == null) return '<span class="muted">—</span>';
        return `<span title="Full-pipeline days of cover (Total Stock + AWD Avail + AWD Transit) ÷ Avg/day. Keep-level 90d.">${nf(d)}</span>`; } },
    // Reorder decision (90-day keep-level ladder): <90 Air→90 +Sea→120 (Sea only if air-excluded) ·
    // 90–120 Sea→120 · 120–150 AWD→150 · ≥150 OK. Lane shows only when incoming doesn't already cover it.
    { k: 'decision', t: 'Send', noTotal: 1,
      cell: r => {
        if (r.stopped) return `<span class="send send-stop" title="${esc(r.stopReason || 'Discontinued')} → stopped, no future projection">Stopped</span>`;
        const d = r.decision || ''; if (!d) return '<span class="muted">—</span>';
        const tip = `Cover ${r.coverDos ?? '—'} days (keep-level 90)${r.airExcluded ? ' · air-excluded sub-category (can\'t fly)' : ''}`;
        if (d === 'Air+Sea') return `<span class="send send-air" title="${tip}">Air</span><span class="send send-sea" title="${tip}">Sea</span>`;
        const cl = d === 'Sea' ? 'send-sea' : d === 'AWD' ? 'send-awd' : d === 'Air' ? 'send-air' : 'send-ok';
        return `<span class="send ${cl}" title="${tip}">${d}</span>`;
      } },
    // India stock available — from the list the user uploads in the India Stock tab.
    // Subtotalled: a SKU missing from the uploaded list maps to undefined, so the total must treat that
    // as 0 rather than letting it turn the sum into NaN (see the subtotal's Number()||0 guard).
    { k: 'indiaStock', t: 'India Stock', num: 1, map: r => (INDIA_LOADED ? INDIA_STOCK[String(r.sku).toUpperCase()] : null),
      tip: 'Units available in India, from the India Stock tab (uploaded by you). — if the SKU is not in that list.',
      cell: r => {
        if (!INDIA_LOADED) return '<span class="muted" title="The warehouse list is still being read — it is the slowest thing this screen asks for, so the table is drawn without waiting for it.">…</span>';
        const v = INDIA_STOCK[String(r.sku).toUpperCase()];
        return v == null ? '<span class="muted">—</span>' : (typeof v === 'number' ? nf(v) : esc(String(v)));
      } },
    // What a factory is already making for this SKU, from the In Production tab. Sits next to India
    // Stock because the two together are the answer to "do we need to make anything at all".
    { k: 'inProd', t: 'In Production', num: 1, map: r => r._sup.prodQty,
      tip: 'Units still being made, from the Order Console: ordered less pressed, over every order line that is still open. The order’s own delivery date decides which month they can first cover — hover a “← Production” cell for that.',
      cell: r => { const s = r._sup;
        if (!s.prodQty) return '<span class="muted">—</span>';
        const guessed = !!INPROD_GUESSED[skuKey(r.sku)];
        const covers = esc((FC_PLAN[s.arrival] || {}).label || 'after the horizon');
        return `<span class="pill pill-sea" title="${guessed
            ? `No Ready Date on the uploaded row. These units ARE counted — the batch is assumed to take a full production cycle (${LEAD.prod}d) from today, so it first covers ${covers}.`
            : `Ready ${esc(s.ready)} — first covers ${covers}`}">${nf(s.prodQty)}</span>`
          + (guessed ? ' <span class="lane lane-late" title="The order these pieces are on promised no delivery date, so they are counted on an assumed one - a full production cycle from today. Put a delivery date on that sales order for the real month.">no date</span>' : ''); } },
  );

  // ---- Month-by-month forecast: On Hand → Proj → Excess, carried forward (see replForecast). ----
  FC_PLAN.forEach((p, i) => {
    const dayNote = p.partial
      ? `the ${p.days} day${p.days === 1 ? '' : 's'} still left in ${p.label} (today included)`
      : `all ${p.days} days of ${p.label}`;
    const ohTip = i === 0
      ? `Inventory available for ${p.label}: Warehouse + Inbound Receiving${p.recCol ? ` + the "${p.recCol}" receipts column` : ''} + AWD Available. AWD Transit is NOT included here — it is credited to the month it actually lands in.`
      : `Inventory available for ${p.label}: last month's Excess (floored at 0)` + (p.recCol ? ` + the "${p.recCol}" receipts column` : ' (no receipts column matched this month)') + ', plus any AWD Transit due to arrive in this month.';
    defs.push(
      { k: `fc${i}oh`, t: `${p.label} · On Hand`, num: 1, map: r => r._fc[i].oh, tip: ohTip },
      { k: `fc${i}proj`, t: `${p.label} · Proj${p.partial ? ` (${p.days}d left)` : ''}`, num: 1, map: r => r._fc[i].proj,
        tip: `Projected sales = Avg/day × ${dayNote}. CLICK a cell to type your own number — a manual projection is kept until you change it (a "Refresh from sheet" never overwrites it).`,
        cell: r => { const f = r._fc[i];
          return `<span class="projcell${f.manual ? ' projman' : ''}" data-sku="${esc(r.sku)}" data-mk="${p.key}" data-auto="${f.auto}"`
            + ` title="${f.manual ? `Manually set to ${nf(f.proj)} — calculated was ${nf(f.auto)}. Click to change, clear the box to go back to auto.` : 'Click to type your own projection'}">`
            + `${nf(f.proj)}${f.manual ? ' <span class="pmark">✎</span>' : ''}</span>`; } },
      { k: `fc${i}exc`, t: `${p.label} · Excess`, num: 1, map: r => r._fc[i].exc,
        tip: `On Hand − Proj for ${p.label}. Negative means you run out part-way through the month.`
          + ' A short month is tagged with the lane that can still cover it: SEA if a sea shipment lands in time, AIR if only air can, LATE if neither will.',
        cell: r => { const v = r._fc[i].exc, L = r._lanes, lane = L.by[i], by = L.byDate[i];
          const d = by == null ? '' : dShort(by);
          const tag = lane === 'sea' ? `<span class="lane lane-sea" title="Dispatch from India by ${esc(d)} and a SEA shipment (${LEAD.sea}d) is sellable at FBA in time for ${esc(p.label)}. Goods can leave from ${esc(dShort(L.from))}.">SEA by ${esc(d)}</span>`
            : lane === 'air' ? `<span class="lane lane-air" title="Sea would have had to leave India by ${esc(dShort(LANE_CTX.needBy[i] - LEAD.sea * DAY_MS))} — that has gone. Dispatch by ${esc(d)} and AIR (${LEAD.air}d) still makes ${esc(p.label)}. Goods can leave from ${esc(dShort(L.from))}.">AIR by ${esc(d)}</span>`
            : lane === 'late' ? `<span class="lane lane-late" title="Even air had to leave India by ${esc(d)}, and your goods can only leave from ${esc(dShort(L.from))}. Nothing can reach FBA in time for ${esc(p.label)} — this stock-out can no longer be prevented.">LATE — ${esc(d)}</span>` : '';
          return `<span style="color:${v < 0 ? 'var(--bad)' : '#166534'};font-weight:${v < 0 ? 700 : 400}">${nf(v)}</span>${tag}`; } },
    );
    // Where that month's shortfall gets settled. Off by default only because it triples the width of
    // the forecast block — the numbers themselves are always computed, so the toggle costs nothing.
    if (SUPPLY_COLS) defs.push(
      { k: `fc${i}ind`, t: `${p.label} · ← India`, num: 1, map: r => r._sup.m[i].india,
        tip: `Units of the India stock eaten by ${p.label}'s shortfall. The balance carries: what August does not use is still there in September, which is why this cannot be read off the Excess columns.`,
        cell: r => { const v = r._sup.m[i].india;
          if (!v) return '<span class="muted">—</span>';
          // Flagged on the month the stock runs dry — that is the deadline for a decision, not a
          // quantity to argue about.
          const dry = r._sup.m[i].fresh > 0 || r._sup.indiaLeft === 0 && !r._sup.m.slice(i + 1).some(x => x.india > 0);
          return `<span class="pill pill-ok">${nf(v)}</span>${dry && r._sup.m[i].fresh > 0 ? ' <span class="lane lane-late" title="India stock does not stretch to the end of this month">dry</span>' : ''}`; } },
      { k: `fc${i}prd`, t: `${p.label} · Production`, num: 1, map: r => r._sup.m[i].needProd,
        tip: `What ${p.label} needs OUT OF PRODUCTION: that month's shortfall after India stock has been applied. India stock is a RUNNING BALANCE — whatever a month does not use carries to the next one, and so does any excess stock, so a month only appears here once the earlier cover has genuinely run out. The pill beside the number is how much of it a batch already on a machine will cover; the rest is the Produce column.`,
        cell: r => {
          const c = r._sup.m[i];
          if (!c.needProd) return '<span class="muted">—</span>';
          /* The number is what production has to DELIVER for this month. Beside it, how much of that
           * is already being made — without that split, "needed" and "still to arrange" look like the
           * same figure, and somebody starts a second run for goods already on a machine. */
          return `<span style="font-weight:700">${nf(c.needProd)}</span>`
            + (c.prod
                ? ` <span class="pill pill-sea" title="Already covered by a batch on a machine">${nf(c.prod)} running</span>`
                  + (INPROD_GUESSED[skuKey(r.sku)]
                      ? ` <span class="lane lane-late" title="The order behind that batch promised no delivery date, so it is assumed to take a full production cycle (${LEAD.prod}d) from today. Put a delivery date on the sales order for the real month.">assumed</span>` : '')
                : '');
        } },
      { k: `fc${i}new`, t: `${p.label} · Produce`, num: 1, bold: 1, map: r => r._sup.m[i].fresh,
        tip: `A NEW production order for ${p.label} — what no existing batch can cover, ever. A shortfall that a batch already on a machine WILL cover, just too late, is not counted here; it shows as "late" instead, because the answer there is to pull that batch forward or fly part of it. Opening a fresh order for goods already being made is how the same units get paid for twice.`,
        cell: r => {
          const c = r._sup.m[i];
          const parts = [];
          if (c.fresh) parts.push(`<span style="color:var(--bad);font-weight:700">${nf(c.fresh)}</span>`);
          /* The units EXIST. Naming them separately is the whole point: the action is to chase that
           * batch or air-freight part of it, never to start another one. */
          if (c.late) parts.push(`<span class="lane lane-late" title="${nf(c.late)} unit(s) short for ${esc(p.label)}, but ${nf(r._sup.prodQty)} are already in production and land later. Do NOT open a new order — pull that batch forward, or air-freight part of it.">${nf(c.late)} late</span>`);
          return parts.length ? parts.join(' ') : '<span class="muted">—</span>';
        } },
    );
  });

  /* "Sea Req (fcst)" and "Air Req (fcst)" were REMOVED on Ravi's instruction, 2026-08-23. They said
   * the same thing twice: every short month already carries its own SEA / AIR / LATE tag with the
   * dispatch date inside its Excess cell, and the Air/Sea/AWD Req columns further right are the ones
   * a PO is actually raised from. `fcLanes` still runs — those tags and "Cannot cover" below read
   * from it, so nothing was deleted from the calculation, only from the width of the table. */
  defs.push(
    { k: 'fcLate', t: 'Cannot cover', num: 1, map: r => r._lanes.late,
      tip: 'Units short in months that NEITHER sea nor air can reach in time (or the sub-category cannot fly). This stock-out can no longer be prevented — the only lever left is the projection itself.',
      cell: r => { const v = r._lanes.late; return v ? `<span class="st st-stop">${nf(v)}</span>` : '<span class="muted">—</span>'; } },
  );

  defs.push(
    // Required units per lane (Send decision + 150-day ceiling + 1-month-per-lane cap). See replReq().
    // Each lane is paired with what you can ship FROM India stock (sheet's ←India logic; min-ship 5).
    { k: 'reqAir', t: 'Air Req', num: 1, map: r => r._req.air,
      tip: 'Units to AIR to reach the 90-day keep-level (cover < 90d). Incoming stock already credited.' },
    { k: 'airIndia', t: 'Air ← India', num: 1, map: r => r._ind.airInd,
      tip: 'Of the Air Req, how many you can send by AIR from India stock (air takes its share first; nothing under 5 units ships).',
      cell: r => { const v = r._ind.airInd; return v ? `<span class="pill pill-air">${nf(v)}</span>` : '<span class="muted">—</span>'; } },
    { k: 'reqSea', t: 'Sea Req', num: 1, map: r => r._req.sea,
      tip: 'Units to SEA to top up toward 120d (90 + 1 month). Incoming netted; capped at ~1 month.' },
    { k: 'seaIndia', t: 'Sea ← India', num: 1, map: r => r._ind.seaInd,
      tip: 'Of the Sea Req, how many you can send by SEA from the India stock left after air (nothing under 5 units ships).',
      cell: r => { const v = r._ind.seaInd; return v ? `<span class="pill pill-sea">${nf(v)}</span>` : '<span class="muted">—</span>'; } },
    { k: 'reqAwd', t: 'AWD Req', num: 1, map: r => r._req.awd,
      tip: 'Units to AWD to top up toward 150d (cover 120–150d). Incoming netted; capped at ~1 month.' },
    // Remark as an Excel-style comment: a note marker (hover for the full plain-English explanation), so
    // it takes almost no width and the row height stays governed by the product image. Full text still
    // goes to the CSV export via `map`. Kept LAST so it never breaks up the numeric columns.
    // The full narrative is built LAZILY on hover (see the mouseover handler) — building it for all
    // shown rows every render was the main render cost. The marker only needs a cheap "muted" flag here.
    { k: 'remark', t: 'Remark', noTotal: 1, map: r => replRemark(r).s,
      tip: 'Hover the note icon for the full explanation.',
      cell: r => { const muted = !(r._req.air || r._req.sea || r._req.awd) && !r.awdTransfer;
        return `<span class="note${muted ? ' muted-note' : ''}" data-sku="${esc(r.sku)}">💬</span>`; } },
  );

  const val = (r, d) => (d.map ? d.map(r) : r[d.k]);
  const sd = defs.find(d => d.k === R_SORT.k) || defs.find(d => d.k === 'avgSale') || defs[0];
  rows.sort((a, b) => {
    const x = val(a, sd), y = val(b, sd);
    const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return c * R_SORT.dir;
  });
  R_RENDER = { rows, defs };
  // THE COUNT GOES ON THE BUTTON. Export has always written exactly the filtered rows — the 200-row
  // cap is on the table only — but the button said "Export" and the file was called
  // "replenishment-<date>.csv", so downloading while filtered to 109 out-of-stock SKUs looked
  // indistinguishable from downloading all 4,781. Nobody could tell it had worked.
  $('rCsv').textContent = 'Export · ' + nf(rows.length);
  const ROW_CAP = 200;   // only the visible table is capped — subtotals, KPIs, Export & Create-PO use ALL filtered rows
  const shown = rows.slice(0, ROW_CAP);
  const _tPre = performance.now();   // ← compute+sort done

  const modePill = m => m === 'air' ? '<span class="pill pill-air">Air</span>' : m === 'sea' ? '<span class="pill pill-sea">Sea</span>' : '<span class="muted">—</span>';
  const arrow = d => d.k === R_SORT.k ? (R_SORT.dir < 0 ? ' ↓' : ' ↑') : '';
  // Subtotal row sits right under the column headers (like the sheet's TOTAL at row 2) and sums the
  // numeric columns over EVERY filtered row, not just the 400 shown. Money columns keep the $.
  // Text / no-total columns MERGE their header with the (otherwise blank) cell below via rowspan=2, so
  // there's no empty box under "Image / ASIN / Color / …". Only the SKU label + numeric totals fill row 2.
  // Only numeric-TOTAL columns get a cell in the 2nd header row (their total). Every other column —
  // SKU included — merges its header down over that row via rowspan=2, so there are no blank/label boxes.
  const isTotal = d => d.num && !d.noTotal;
  const titleRow = defs.map(d => {
    const rs = isTotal(d) ? ' data-h1="1"' : ' rowspan="2"';
    return `<th data-k="${esc(d.k)}"${d.tip ? ` title="${esc(d.tip)}"` : ''}${rs} class="${d.frz ? 'frz ' : ''}${d.num ? 'num' : ''}">${esc(d.t)}${arrow(d)}</th>`;
  }).join('');
  const subCells = defs.filter(isTotal).map(d => {
    const sum = rows.reduce((s, r) => s + (Number(val(r, d)) || 0), 0);
    return `<th class="num">${d.money ? '$' + nf(sum) : nf(sum)}</th>`;
  }).join('');
  const head = `<thead><tr>${titleRow}</tr><tr class="subtot">${subCells}</tr></thead>`;
  const body = shown.map(r => '<tr>' + defs.map(d => {
    const cls = (d.frz ? 'frz ' : '') + (d.num ? 'num' : '') + (d.cls ? ' ' + d.cls : '');
    if (d.img) return `<td class="${cls}">${r.image ? `<img class="thumb" src="${esc(thumbUrl(r.image))}" loading="lazy" decoding="async">` : ''}</td>`;
    if (d.mode) return `<td class="${cls}">${modePill(val(r, d))}</td>`;
    if (d.cell) return `<td class="${cls}"${d.bold ? ' style="font-weight:700"' : ''}>${d.cell(r)}</td>`;
    const v = val(r, d);
    if (d.money) return `<td class="${cls}">${v ? '$' + nf(v) : '<span class="muted">—</span>'}</td>`;
    if (d.num) return `<td class="${cls}"${d.bold ? ' style="font-weight:700"' : ''}>${v ? nf(v) : '<span class="muted">—</span>'}</td>`;
    return `<td class="${cls}"${d.mono ? ' style="font-family:ui-monospace,monospace"' : ''}>${esc(v) || '<span class="muted">—</span>'}</td>`;
  }).join('') + '</tr>').join('');
  const _tBody = performance.now();   // ← body HTML string built
  $('rTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="${defs.length}" class="muted">No SKUs match.</td></tr>`) + '</tbody>';
  const _tDom = performance.now();    // ← DOM parsed

  // Pin the subtotal row directly beneath the (sticky) header row — its offset is the header's own
  // height, measured after layout so it's exact regardless of wrapping.
  // Pin the totals row below the title row. Measure a rowspan-1 title cell (a numeric-total header,
  // marked data-h1) — the merged rowspan-2 cells would report the full two-row height and mis-pin it.
  const sRow = $('rTable').querySelector('thead tr.subtot');
  const setSubTop = () => {
    const h1 = $('rTable').querySelector('thead tr:first-child th[data-h1]');
    const top = (h1 ? Math.round(h1.getBoundingClientRect().height) : 0) || 34;
    if (sRow) sRow.querySelectorAll('th').forEach(th => th.style.top = top + 'px');
  };
  // Only measure in rAF — a synchronous getBoundingClientRect() here FORCES a full layout of the
  // just-inserted 400-row table (was ~150ms). rAF reuses the browser's natural paint layout instead.
  requestAnimationFrame(setSubTop);

  $('rTable').querySelectorAll('thead tr:first-child th').forEach(th => th.onclick = () => {
    const k = th.dataset.k; if (!k) return;
    R_SORT = { k, dir: R_SORT.k === k ? -R_SORT.dir : -1 }; renderRepl();
  });

  // Per-brand reorder summary (replaces the old metric tiles): Mode = units to send per lane over the
  // current view; Category A/B/C/D = out-of-stock SKUs / total SKUs in that category, per brand.
  const CATS = ['A', 'B', 'C', 'D'];
  const moneyK = n => n >= 10000 ? '$' + nf(Math.round(n / 1000)) + 'k' : n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + nf(Math.round(n));
  const byBrand = {}; rows.forEach(r => (byBrand[r.brand] = byBrand[r.brand] || []).push(r));   // group once, not per-brand filter
  const sumRow = b => {
    const rs = byBrand[b] || [];
    const air = rs.reduce((s, r) => s + r._req.air, 0), sea = rs.reduce((s, r) => s + r._req.sea, 0), awd = rs.reduce((s, r) => s + r._req.awd, 0);
    const catCells = CATS.map(c => {
      const inc = rs.filter(r => r.category === c);
      const oos = inc.filter(r => !(r.fulfillable > 0)).length;   // OOS = 0 fulfillable at FBA (same as Top sellers)
      return `<td class="sc-cat">${inc.length ? `${nf(oos)}/${nf(inc.length)}` : '—'}</td>`;
    }).join('');
    // The "vital few": the highest-revenue SKUs that together make up the top 60% of the brand's sales
    // (count is dynamic — may be 100, more, or fewer). How many of THEM are out of stock.
    // Uses the SAME flag the switch above uses, marked once over the whole brand. It used to be
    // recomputed from the rows on screen, so the "top 60%" changed meaning whenever anything was
    // filtered — and the summary and the switch would have disagreed the moment both existed.
    const totalRev = rs.reduce((s, r) => s + (r.monthlyAmt || 0), 0);
    const topSet = rs.filter(r => r._top);
    const topRev = topSet.reduce((s, r) => s + (r.monthlyAmt || 0), 0);
    const topOos = topSet.filter(r => !(r.fulfillable > 0)).length;   // OOS = nothing fulfillable at FBA
    const topCell = `<td class="sc-top">${topSet.length ? `${nf(topOos)}/${nf(topSet.length)}<div class="sc-sub">${moneyK(topRev)} of ${moneyK(totalRev)}</div>` : '—'}</td>`;
    return `<tr><td class="sc-bn">${esc(BRAND_NAME[b])}</td><td class="sc-mode">${nf(air)}</td><td class="sc-mode">${nf(sea)}</td><td class="sc-mode">${nf(awd)}</td>${catCells}${topCell}</tr>`;
  };
  const when = brands.map(b => REPL[b]?.at ? BRAND_NAME[b] + ' ' + REPL[b].at.toLocaleDateString() : '').filter(Boolean).join(' · ');
  $('rKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Reorder summary</span><span class="kpiwhen">${esc(when)} · ${nf(rows.length)} SKUs${rows.length > ROW_CAP ? ` (showing first ${ROW_CAP} — filter/sort to narrow)` : ''}</span></div>
    <table class="sumtbl">
      <thead>
        <tr><th class="sc-hb"></th><th colspan="3" class="sc-hmode">Mode — units to send</th><th colspan="4" class="sc-hcat" title="Per category: how many SKUs are out of stock (0 fulfillable at FBA) out of the total SKUs in that category.">Category — out of stock / total</th><th rowspan="2" class="sc-htop" title="The top-selling SKUs that together make up 60% of the brand's sales (revenue) — count is dynamic. Top number = how many of them are out of stock (0 fulfillable at FBA) / how many such SKUs. Below = their monthly sale $ out of the brand's total.">Top sellers (60% sales) · OOS</th></tr>
        <tr><th class="sc-hb">Brand</th><th class="sc-hsub">Air Qty Req</th><th class="sc-hsub">Sea Qty Req</th><th class="sc-hsub">AWD Qty Req</th><th class="sc-hsub">A</th><th class="sc-hsub">B</th><th class="sc-hsub">C</th><th class="sc-hsub">D</th></tr>
      </thead>
      <tbody>${brands.map(sumRow).join('')}</tbody>
    </table></div>`;
  const _end = performance.now();
  console.log(`[repl] ${shown.length}/${rows.length} rows · total ${Math.round(_end - _t0)}ms (compute ${Math.round(_tPre - _t0)} · body ${Math.round(_tBody - _tPre)} · dom ${Math.round(_tDom - _tBody)} · summary ${Math.round(_end - _tDom)})`);
}

$('rCsv').onclick = () => {
  if (!R_RENDER.rows.length) return;
  const { rows, defs } = R_RENDER;
  const cols = defs.filter(d => !d.img);
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const val = (r, d) => (d.map ? d.map(r) : (d.mode ? r._mode : r[d.k]));
  const lines = [cols.map(d => cell(d.t || d.k)).join(',')];
  rows.forEach(r => lines.push(cols.map(d => cell(val(r, d))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  // Named after the view, so a folder of these can be told apart a week later without opening them.
  const SLUG = { outsell: 'out-of-stock-selling', outdead: 'out-of-stock-no-sale',
    '15': 'runs-out-1-15d', '30': 'runs-out-16-30d', '45': 'runs-out-31-45d',
    '60': 'runs-out-46-60d', ok: 'over-60d' };
  const bits = ['replenishment'];
  if (R_COVER) bits.push(SLUG[R_COVER] || R_COVER);
  const subs = msVals('rSubcat');
  if (subs.length === 1) bits.push(subs[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  else if (subs.length) bits.push(subs.length + '-subcats');
  if ($('rBrand').value !== 'ALL') bits.push($('rBrand').value.toLowerCase());
  bits.push(new Date().toISOString().slice(0, 10));
  a.download = bits.join('-').replace(/-+/g, '-') + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
  rMsg(`Downloaded ${nf(rows.length)} SKU(s) — exactly what is on screen, not the whole catalogue.`);
};

// Seed a PO from the SKUs currently in view that need reorder, using the suggested mode+qty.
$('rPo').onclick = () => {
  /* WHAT TO ORDER IS NOT WHAT IS REQUIRED.
   *
   * The requirement nets off FBA and AWD, and nothing else. It does NOT know about the stock sitting
   * in India, and it does not know what is already on a factory floor — so a PO built straight from
   * it orders both again. On a catalogue this size that is a second container of goods you already
   * own or have already paid to make.
   *
   * ORDER OF DEDUCTION, and why:
   *   INDIA STOCK comes off AIR first. It exists now and it can fly, so it answers the urgent lane.
   *   IN PRODUCTION comes off SEA first. It does not exist yet — it has to be made and then shipped,
   *   which is the slow lane's timescale anyway.
   * Taking them off in the other order would cancel an air requirement with goods that are still on
   * a loom, which is how a stockout gets planned in.
   *
   * Every deduction is written onto the line and totalled in the message, because a quantity that
   * quietly shrank is the one thing nobody would question.
   */
  const needy = R_RENDER.rows.filter(r => r._req.air > 0 || r._req.sea > 0 || r._req.awd > 0);
  if (!needy.length) { rMsg('Nothing in the current view needs reordering.', true); return; }
  const brand = $('rBrand').value === 'CPC' ? 'CPC' : 'SP';
  const brandRows = needy.filter(r => r.brand === brand);
  const use = brandRows.length ? brandRows : needy;
  const pmap = R_PMAP || inProdMap();

  let cutIndia = 0, cutProd = 0, dropped = 0, rawTotal = 0;
  const lines = use.map(r => {
    const k = String(r.sku || '').toUpperCase();
    let air = r._req.air || 0;
    let sea = (r._req.sea || 0) + (r._req.awd || 0);      // AWD folds into the non-air lane
    rawTotal += air + sea;

    let ind = Number(INDIA_STOCK[k]) || 0;
    const iAir = Math.min(air, ind); air -= iAir; ind -= iAir;
    const iSea = Math.min(sea, ind); sea -= iSea; ind -= iSea;

    let pr = Number((pmap[k] || {}).qty) || 0;
    const pSea = Math.min(sea, pr); sea -= pSea; pr -= pSea;
    const pAir = Math.min(air, pr); air -= pAir; pr -= pAir;

    cutIndia += iAir + iSea; cutProd += pSea + pAir;
    const note = [
      (iAir + iSea) ? (iAir + iSea) + ' already in India' : '',
      (pSea + pAir) ? (pSea + pAir) + ' already in production' : '',
    ].filter(Boolean).join(', ');
    return { sku: r.sku, subcat: r.subcat || '', color: r.color || '', size: r.size || '',
      airQty: air, seaQty: sea, qty: air + sea, note: note };
  }).filter(l => {
    // A SKU fully covered by India stock and production needs no PO at all. Counted, not silently gone.
    if (l.qty > 0) return true;
    dropped++; return false;
  });

  if (!lines.length) {
    rMsg('Nothing left to order: every SKU in this view is already covered by India stock and goods '
      + 'in production (' + nf(cutIndia) + ' units in India, ' + nf(cutProd) + ' in production).', true);
    return;
  }
  openPoEditor(null, {
    brand: use[0].brand,
    mode: lines.filter(l => l.airQty > 0).length >= lines.length / 2 ? 'air' : 'sea',
    lines: lines,
  });
  const total = lines.reduce((n, l) => n + l.qty, 0);
  rMsg('PO built on what is actually still needed: ' + nf(total) + ' units, down from '
    + nf(rawTotal) + ' required — ' + nf(cutIndia) + ' already in India and '
    + nf(cutProd) + ' already in production were taken off'
    + (dropped ? ', and ' + dropped + ' SKU(s) needed nothing at all' : '') + '.');
};

