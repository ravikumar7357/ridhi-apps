/* ================= LISTING · PRIORITY — 🔴 Critical · 🟠 Important · ⚪ Can wait (20 Nov 2026) =================
 * ONE shared rule, no AI (works without the key), the same label on every screen and in every download:
 *   🔴 Critical — fix today      has stock (or, stock not known, is live) AND one of: an Amazon error, suppressed / hidden from search, no
 *                                main picture, another brand's name (trademark)
 *   🟠 Important — this week     has stock (or live) AND one of: A+ missing / draft / rejected, search terms over 249 bytes, the title breaks a
 *                                company rule, too few pictures, a wrong / mixed / missing category
 *   ⚪ Can wait                   0 stock / not live, or only "Good to fill" (and every other problem)
 * A listing's problems: what Listing Health finds for it (its detectors) plus the screen's own (A+ status, a trademark word, a category
 * problem, the Image Manager's picture problems) — so the label is the listing's, wherever it is shown. It changes NO count and adds no
 * problem: it only sorts what is already found.
 * Within a level: the most 30-day sales first (Sellora's sales pull); when the sales are older than 7 days — "sales data old" — the most
 * stock first. Used by: Listing Health (Why column, the side panel), the Workspace, Listing Errors, the Image Manager, A+ Content, IP &
 * Trademark Guard, Family & Category Check — their chips, their filters and their downloads ("Priority" column) — and ✨ Fix these first.
 * Main functions: prLevel, prOf, prChipHtml, prSort, prSalesOld, prFilterHtml, prKeep, prCsv. Every name starts with pr / PR. */

const PR_LEVELS = {
  crit: { i: '🔴', t: 'Critical', sub: 'fix today', cls: 'is-r', n: 0 },
  imp: { i: '🟠', t: 'Important', sub: 'this week', cls: 'is-y', n: 1 },
  wait: { i: '⚪', t: 'Can wait', sub: '', cls: 'is-g', n: 2 },
};
// The problems that make a listing with stock Critical / Important. Keys: Listing Health's detectors and each screen's own words.
const PR_CRIT = new Set(['amazon_error', 'amazon_suppressed', 'no_main_image', 'trademark', 'amzerr', 'sup', 'nomain', 'tm']);
const PR_IMP = new Set(['aplus_missing', 'aplus_draft', 'aplus_rejected', 'keyword_bytes', 'title_template', 'size_format', 'dimension_order', 'title_length', 'title_keyword',
  'title_contains', 'variation_naming', 'images_below', 'few', 'wrong_category', 'cat_mixed', 'cat_none', 'cat_rank']);
let PR = { f: {}, memo: new WeakMap(), memoCtx: null };

/** THE RULE. o: { stock (number, null = not known), live (true / false), problems: [keys] } → 'crit' | 'imp' | 'wait'. */
function prLevel(o) {
  o = o || {};
  const stock = o.stock == null || o.stock === '' ? null : Number(o.stock);
  const has = stock != null && !isNaN(stock) ? stock > 0 : !!o.live;
  if (!has) return 'wait';
  const probs = o.problems || [];
  if (probs.some(k => PR_CRIT.has(k))) return 'crit';
  if (probs.some(k => PR_IMP.has(k))) return 'imp';
  return 'wait';
}
// The Listing Health row of a listing, or null.
function prRow(brand, sku) {
  const rows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
  if (!PR.rows || PR.rows.src !== rows) PR.rows = { src: rows, map: new Map(rows.map(r => [r.sku, r])) };
  return PR.rows.map.get(sku) || null;
}
// What Listing Health finds for a row (its own judging, kept per row while the rules' context is the same).
function prFound(row) {
  if (!row) return [];
  if (row._h && row._h.found) return row._h.found;
  let ctx = null;
  try { ctx = typeof hCtx === 'function' ? hCtx() : null; } catch (e) { ctx = null; }
  if (!ctx || typeof healthOf !== 'function') return [];
  if (PR.memoCtx !== ctx) { PR.memo = new WeakMap(); PR.memoCtx = ctx; }
  if (PR.memo.has(row)) return PR.memo.get(row);
  let found = [];
  try { found = (healthOf(row, ctx).found || []).filter(h => !h.fill); } catch (e) { found = []; }
  PR.memo.set(row, found);
  return found;
}
/** One listing's level: { k: crit | imp | wait, stock, live, problems } — its Listing Health problems plus `extra` (the screen's own keys).
 *  stock / live: the screen's own when it has them, else Listing Health's (qty, Active) / the stock Sellora holds. */
function prOf(brand, sku, extra, o) {
  o = o || {};
  const row = o.row || prRow(brand, sku);
  const found = prFound(row).filter(h => !h.fill).map(h => h.detector);
  let stock = o.stock !== undefined ? o.stock : row && row.qty != null ? row.qty : null;
  if (stock == null && typeof lrQtyOf === 'function') { try { stock = lrQtyOf(brand, sku); } catch (e) { stock = null; } }
  const live = o.live !== undefined ? !!o.live : !!(row && /active/i.test(row.status || '') && !/inactive/i.test(row.status || ''));
  const problems = [...new Set(found.concat(extra || []))];
  return { k: prLevel({ stock, live, problems }), stock, live, problems };
}
/** The chip: "🔴 Critical" (title: "fix today"). The classes of the screen's own chips are passed (cls), so it looks like them. */
function prChipHtml(k, cls) {
  const L = PR_LEVELS[k] || PR_LEVELS.wait;
  const esc = s => String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  return `<span class="pr-chip ${cls || ''} ${L.cls}" title="${esc(L.t + (L.sub ? ' — ' + L.sub : ''))}">${L.i} ${esc(L.t)}</span>`;
}
// The download's words for a level ("Critical — fix today").
const prCsv = k => { const L = PR_LEVELS[k] || PR_LEVELS.wait; return L.t + (L.sub ? ' — ' + L.sub : ''); };
/** Sales older than 7 days (or none): the date in words, else ''. Then a level is ordered by stock instead. */
function prSalesOld() {
  if (typeof apcSalesAt !== 'function' || !apcSalesAt()) return 'no sales data';
  return typeof apcSalesOld === 'function' ? apcSalesOld() : '';
}
/** Order: Critical, Important, Can wait; within each the most 30-day sales first (sales data old: the most stock first). items: [x];
 *  of(x) → { k, asin, stock }. A stable sort: equal ones keep their order. */
function prSort(items, of) {
  const old = !!prSalesOld();
  const key = x => { const o = of(x); const sales = !old && o.asin && typeof apcSales === 'function' ? apcSales(o.asin) : null; return { n: (PR_LEVELS[o.k] || PR_LEVELS.wait).n, v: old || sales == null ? Number(o.stock) || 0 : sales }; };
  return items.map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => a.k.n - b.k.n || b.k.v - a.k.v || a.i - b.i).map(e => e.x);
}
/** The filter chips of a screen, in that screen's own chip markup: make(k, label, on) → its chip's HTML. Pressed again: off. */
function prFilterHtml(screen, make) {
  return ['crit', 'imp', 'wait'].map(k => make(k, `${PR_LEVELS[k].i} ${PR_LEVELS[k].t}`, PR.f[screen] === k)).join('');
}
// Does a listing pass a screen's priority filter (none chosen: every listing)?
const prKeep = (screen, k) => !PR.f[screen] || PR.f[screen] === k;
// A filter chip pressed: on, or off when pressed again. Returns the new value.
function prToggle(screen, k) { PR.f[screen] = PR.f[screen] === k ? '' : k; return PR.f[screen]; }

/** CONSOLE: prReport() — per brand, how many listings with a problem are Critical / Important / Can wait (Listing Health's rows). */
function prReport(brands) {
  const out = {};
  (brands || ['SP', 'CPC']).forEach(b => {
    const rows = (typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || [];
    const n = { crit: 0, imp: 0, wait: 0, noProblem: 0 };
    rows.forEach(r => { const p = prOf(b, r.sku); if (!p.problems.length) n.noProblem++; else n[p.k]++; });
    out[b] = n;
  });
  if (typeof console !== 'undefined') console.log('Priority', out);
  return out;
}

/* ----- each screen's listing → its level (the screen's own problems added to Listing Health's) ----- */
const PR_APC = { missing: 'aplus_missing', draft: 'aplus_draft', rejected: 'aplus_rejected' };
const prApc = p => prOf(p.c.brand, p.c.sku, PR_APC[p.bucket] ? [PR_APC[p.bucket]] : [], { stock: p.c.stock, live: !!p.c.live }).k;
const prIpg = p => prOf(p.c.brand, p.c.sku, p.tm > 0 ? ['tm'] : [], { stock: p.c.stock, live: p.c.live !== false }).k;
const prCc = r => prOf(r.c.brand, r.c.sku, (r.probs || []).map(x => 'cat_' + x.k), { stock: r.c.stock, live: r.c.live !== false }).k;
const prFc = r => prOf(r.c.brand, r.c.sku, [], { stock: r.c.stock, live: true }).k;
const prKid = kid => prOf(kid.brand, kid.sku, [], { stock: kid.row ? kid.row.qty : undefined, live: !!kid.live }).k;
// Listing Errors / Image Manager: Amazon's errors, suppressed (THE one Suppressed rule, imState), the Image Manager's picture problems
function prAmzOf(brand, x) {
  const extra = [];
  if ((x.iss || []).some(i => i.s === 'E') || x.ie) extra.push('amazon_error');
  try { if (typeof imState === 'function' && imState(x, brand).k === 'sup') extra.push('amazon_suppressed'); } catch (e) { /* no state */ }
  return extra;
}
const prLe = (brand, x) => prOf(brand, x.sku, prAmzOf(brand, x)).k;
function prIm(brand, item) {
  let own = [];
  try { own = typeof imProblems === 'function' ? imProblems(item, brand).slice() : []; } catch (e) { own = []; }
  return prOf(brand, item.sku, prAmzOf(brand, item).concat(own)).k;
}