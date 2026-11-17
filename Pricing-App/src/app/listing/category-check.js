/* ================= LISTING · FAMILY & CATEGORY CHECK — the CATEGORIES tab: is every live product in the right Amazon category? =================
 * Screens: Listing → 2 · Check → Family & Category Check → Categories (the second tab of #fcPane; family-check.js draws the shell and the
 *       Families tab and hands this tab to ccDraw). Same look as Families: the same cards, chips, arrows, rows and buttons (fc-* classes).
 * DATA — AMAZON ONLY, NOTHING GUESSED: each ASIN's browse path (classifications) and sales ranks from the ListingMatch cache, read through
 *       its one door (listing-match.js lmGetAsin → { bc: 'Home & Kitchen › … › Tablecloths', rk: { main, sub }, img }). The saved copy in the
 *       browser first, so the tab opens with no network wait; opening a family reads nothing. An ASIN the cache does not hold — or no
 *       usable cache at all (missing, or older than 24 hours) — shows a grey "Category not read yet": never an error, never a count.
 *       Which children are live (buyable AND stock > 0) and how they are grouped into families is the Families tab's own answer (fcBuild).
 * THE THREE ERRORS (red; live children only), each with one plain line and a "What to do":
 *   Mixed category — the child's browse path is not the one most of its family is in (the family's category = the path with the most
 *                    live children; a tie goes to the side with more stock).
 *   No category    — Amazon's catalog answered for this live ASIN and holds no browse node for it.
 *   Rank mismatch  — the category its best-seller rank is in (Amazon's classification rank) is nowhere on its browse path. An amber
 *                    "check" (like Different theme in Families), not a red error: Amazon ranks some listings in a neighbouring shelf.
 *   A child with none of them shows a small green tick and nothing else.
 *   BY ID WHEN AMAZON'S IDS ARE THERE, BY NAME WHEN THEY ARE NOT: ListingMatch keeps the category id of every step of the browse path
 *   (`bcIds`) and every category rank with its id (`rks`). Two children are in the same category when their last ids are equal; a rank is
 *   on the path when its id is one of the path's ids — and the rank is fine when ANY of Amazon's ranks is. A record from before the ids
 *   were kept (or a family where one child still has such a record) is compared by the names. For a rank, by ID ONLY when the ids are
 *   there; by name (old data) a rank is on the path when one name holds the other as whole words ("Window Curtain Panels" / "Panels",
 *   "Bed Pillow Shams" / "Pillow Shams") or both end in the same word — only clearly different names are flagged (ccNameLike).
 * CORRECT ON PURPOSE: the team's mark on an error row (one row, or ticked rows / "Select all in family" with one button). The child leaves
 *       the errors for good; who marked it and when are saved the way "Removed on purpose" is (listingrules/catok_<brand>, kind 'catok',
 *       through lsGet / lsSave — the existing collection and rule). "N marked correct › Show", each with Undo.
 * The page: four number cards and the filter chips (All · Mixed category · No category · Rank mismatch · Correct on purpose), search (SKU,
 *       ASIN, family, category), every family one closed line — the families with the most errors first — Open all / Close all, Export CSV
 *       of what is in view, and "All live products are in the right category ✓" when there is nothing to fix.
 * Console: ccReport() — how many of each error per brand, on the data this page holds.
 * Main functions: ccInfo, ccBuild, ccGroups, ccDraw, ccToggle, ccOkSetMany, ccOkUndo, ccCsv, ccReport. Every name starts with cc / CC. */

const CC_STEP = 60;                                   // family lines drawn at a time; more as the list scrolls
const CC_OK_DOC = brand => 'catok_' + brand;          // the "correct on purpose" marks, beside famok_<brand> in listingrules
const CC_COLS = 8;
const CC_KINDS = [
  { k: 'mixed', t: 'Mixed category', sev: 'r', tip: 'Live children in a different category from most of their family.' },
  { k: 'none', t: 'No category', sev: 'r', tip: 'Live ASINs Amazon has no browse node (category) for.' },
  { k: 'rank', t: 'Rank mismatch', sev: 'y', tip: 'To check, not an error: the best-seller rank is in a category that is not on the listing\'s browse path.' },
];
const CC_SEV = Object.fromEntries(CC_KINDS.map(k => [k.k, k.sev]));   // r = error (red), y = check (amber)
const CC_HINT = {
  none: 'Shoppers can\'t find it by browsing. Check the product type / item type keyword in Seller Central.',
  rank: 'Amazon may have placed it wrong. Check the item type keyword.',
};
let CC = { f: '', brand: 'ALL', q: '', open: new Set(), sel: new Set(), limit: CC_STEP,
  ok: { SP: {}, CPC: {} }, okLoaded: false, okLoading: null, okV: 0, okNote: '', showOk: false,   // the marks: brand → { id: { on, by, name, at, … } }
  order: null, orderKey: '',     // the families' order (most errors first), kept while the data is the same so a mark never moves a line
  view: null, io: null, qT: 0 };

/* ----- one child's category, as Amazon holds it ----- */
const ccN = s => String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
// Two category names are the same node: equal once case, "&" / "and" and punctuation are set aside (a name the cache cut at 80 letters: its start).
const ccSame = (a, b) => { const x = ccN(a), y = ccN(b); return !!x && !!y && (x === y || (String(a).length >= 80 && y.startsWith(x)) || (String(b).length >= 80 && x.startsWith(y))); };
// "Home & Kitchen › Kitchen & Dining › Kitchen & Table Linens › Tablecloths" → the short path people read: the department, the shelf, the product.
const ccShort = parts => (parts.length <= 3 ? parts : [parts[0], parts[parts.length - 2], parts[parts.length - 1]]).join(' › ');
// The mark's / tick's id of a child: its ASIN (our SKUs on one ASIN are one child), else its SKU.
const ccId = c => c.asin || 'sku:' + c.sku;
// Is this rank's category one of the steps of the browse path? By Amazon's category id when the path's ids and the rank's id are there,
// else by the name.
const ccOnPath = (rank, parts, ids) => (ids.length && rank.id ? ids.includes(String(rank.id)) : parts.some(name => ccNameLike(name, rank.c)));
/** OLD DATA ONLY (no category ids): are two category NAMES the same shelf? Yes when, with case, "&" / "and" and punctuation set aside,
 *  they are equal, one holds the other as whole words ("Window Curtain Panels" / "Panels", "Bed Pillow Shams" / "Pillow Shams"), or
 *  both end in the same word ("Throw Pillow Covers" / "Decorative Pillow Covers"). Only clearly different names are a mismatch. */
function ccNameLike(a, b) {
  const words = s => ccN(s).split(' ').filter(w => w && w !== 'and');
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  const X = ' ' + x.join(' ') + ' ', Y = ' ' + y.join(' ') + ' ';
  if (X.includes(Y) || Y.includes(X) || ccSame(a, b)) return true;
  const last = x[x.length - 1];
  return last.length >= 3 && last === y[y.length - 1];
}
/** { state: 'ok' | 'none' (Amazon has no browse node) | 'unread' (not in the cache), parts, full, short, leaf, ids (the path's category ids,
 *  [] when the record has none), nameKey, idKey, ranks (every category rank), rankOn (one of them is on the path), sub (the best one),
 *  bsr (the rank shown), main, pic, at }. */
function ccInfo(c) {
  const rec = c.asin && typeof lmGetAsin === 'function' ? lmGetAsin(c.asin, c.brand) : null;
  if (!rec) return { state: 'unread', parts: [], full: '', short: '', leaf: '', ids: [], nameKey: '', idKey: '', ranks: [], rankOn: false, sub: null, bsr: null, main: null, pic: '', at: 0 };
  const parts = String(rec.bc || '').split('›').map(s => s.trim()).filter(Boolean);
  const rk = rec.rk || {};
  // the ids count only when Amazon gave one for every step of the path (a record from before 17 Nov has none: the names decide)
  const ids = Array.isArray(rec.bcIds) && rec.bcIds.length === parts.length && rec.bcIds.every(Boolean) ? rec.bcIds.map(String) : [];
  const sub = rk.sub && rk.sub.r > 0 ? rk.sub : null;
  const ranks = Array.isArray(rec.rks) && rec.rks.length ? rec.rks.filter(x => x && x.r > 0).slice().sort((a, b) => a.r - b.r) : sub ? [sub] : [];
  const on = ranks.filter(x => ccOnPath(x, parts, ids));
  return { state: parts.length ? 'ok' : 'none', parts, full: parts.join(' › '), short: ccShort(parts), leaf: parts[parts.length - 1] || '', ids,
    nameKey: parts.map(ccN).join('>'), idKey: ids.length ? ids[ids.length - 1] : '', ranks, rankOn: on.length > 0, sub: ranks[0] || null, bsr: on[0] || ranks[0] || null,
    main: rk.main && rk.main.r > 0 ? rk.main : null, pic: rec.img && rec.img.MAIN && rec.img.MAIN.u ? String(rec.img.MAIN.u) : '', at: rec.readAt || 0 };
}
// "#1,234 in Tablecloths": the category rank (the one on its browse path when Amazon gives several), else the department rank; '' when none.
const ccBsr = info => (info.bsr ? `#${fcNf(info.bsr.r)} in ${info.bsr.c}` : info.main ? `#${fcNf(info.main.r)} in ${info.main.c}` : '');

/* ----- the marks (listingrules/catok_<brand>) ----- */
function ccOkLoad() {
  if (CC.okLoaded || CC.okLoading) return CC.okLoading;
  CC.okLoading = (async () => {
    for (const b of ['SP', 'CPC']) {
      try {
        const data = typeof lsGet === 'function' ? await lsGet(FC_OK_COLL, CC_OK_DOC(b)) : null;
        if (data && data.items) CC.ok[b] = Object.assign({}, data.items, CC.ok[b]);
      } catch (e) { CC.okNote = 'Could not read the "correct on purpose" marks: ' + ((e && e.message) || e); }
    }
    CC.okLoaded = true;
    CC.okLoading = null;
    CC.okV++;
    if (FC.tab === 'cat') ccDraw();
  })();
  return CC.okLoading;
}
// Save marks for one brand (several at once, one write): the page shows them at once; the save follows.
async function ccOkWrite(brand, entries) {
  Object.assign(CC.ok[brand], entries);
  CC.okV++;
  CC.okNote = '';
  ccDraw();
  try {
    const saved = typeof lsSave === 'function' ? await lsSave(FC_OK_COLL, CC_OK_DOC(brand), { kind: 'catok', items: entries }) : false;
    if (!saved) CC.okNote = fcIsTest() ? 'Test site — the mark is kept on this page only, not saved.' : 'Not saved — the mark is kept on this page only.';
  } catch (e) {
    CC.okNote = 'Could not save the mark (' + ((e && e.message) || e) + ') — it is kept on this page only and will show again after a reload.';
  }
  ccDraw();
  return entries;
}
/** Correct on purpose, for one or many error rows (keys "brand|id"): they leave the errors at once and for good; who and when are saved. */
async function ccOkSetMany(keys) {
  const view = ccBuild();
  const by = fcWho(), at = Date.now();
  const per = {};
  view.groups.forEach(g => g.rows.forEach(r => {
    if (!keys.includes(r.key) || !r.probs.length) return;
    (per[r.c.brand] = per[r.c.brand] || {})[ccId(r.c)] = { on: true, by, name: fcName(by), at, sku: r.c.sku, asin: r.c.asin || '', k: r.probs.map(p => p.k).join(','),
      cat: r.info.full.slice(0, 200), fam: String(g.f.name || '').slice(0, 80) };
    CC.sel.delete(r.key);
  }));
  await Promise.all(Object.entries(per).map(([brand, entries]) => ccOkWrite(brand, entries)));
  return Object.values(per).reduce((n, e) => n + Object.keys(e).length, 0);
}
/** Undo (a mistake): the child is an error again; who undid it is kept beside the first mark. */
function ccOkUndo(brand, id) {
  const old = (CC.ok[brand] || {})[id] || {};
  const by = fcWho();
  return ccOkWrite(brand, { [id]: Object.assign({}, old, { on: false, undoneBy: by, undoneName: fcName(by), undoneAt: Date.now() }) });
}

/* ----- building the picture ----- */
/** Every family with its live children's categories and errors: { groups: [{ f, rows, main, errs }], live, unread, usable }.
 *  A row: { c, key, info, probs: [{ k, text, hint }], marked (the mark, when it hides errors), okProbs (what the mark hides) }. */
function ccBuild() {
  const v = FC.view || fcBuild();
  const usable = typeof lmOk === 'function' && lmOk();
  const lmV = typeof lmVersion === 'function' ? lmVersion() + ':' + (lmOk('SP') ? 1 : 0) + (lmOk('CPC') ? 1 : 0) : '';
  if (CC.view && CC.view.src === v && CC.view.lmV === lmV && CC.view.okV === CC.okV) return CC.view;
  const fams = v.families.filter(f => f.live.length).map(f => ({ fk: f.fk, brand: f.brand, name: f.name, psku: f.psku, pa: f.pa, solo: false, kids: f.live }))
    // a live listing with no family is a line of its own: it has a category too (Mixed category cannot apply to it)
    .concat((v.loose || []).map(c => ({ fk: c.brand + '|L:' + ccId(c), brand: c.brand, name: c.title || c.sku, psku: '', pa: '', solo: true, kids: [c] })));
  let live = 0, unread = 0;
  const groups = fams.map(f => {
    const rows = f.kids.map(c => ({ c, key: fcKey(c.brand, ccId(c)), info: ccInfo(c), probs: [], marked: null, okProbs: [] }));
    // the family's category: the browse path most of its live children are in (a tie: the side with more stock, then the first by name).
    // Same category = the same category id when every child of the family has Amazon's ids, else the same path by name.
    const byId = rows.every(r => r.info.state !== 'ok' || r.info.idKey);
    rows.forEach(r => { r.info.key = byId ? r.info.idKey : r.info.nameKey; });
    const tally = new Map();
    rows.forEach(r => {
      if (r.info.state !== 'ok') return;
      const t = tally.get(r.info.key) || { n: 0, stock: 0, info: r.info };
      t.n++;
      t.stock += Number(r.c.stock) || 0;
      tally.set(r.info.key, t);
    });
    const top = [...tally.values()].sort((a, b) => b.n - a.n || b.stock - a.stock || a.info.full.localeCompare(b.info.full))[0] || null;
    const main = top ? top.info : null;
    rows.forEach(r => {
      live++;
      const i = r.info;
      if (i.state === 'unread') { unread++; return; }
      if (i.state === 'none') r.probs.push({ k: 'none', text: 'Amazon has no category (browse node) for this live ASIN.', hint: CC_HINT.none });
      if (i.state === 'ok' && main && i.key !== main.key) {
        // the product names when they differ; two categories with the same last name: the short paths
        const x = ccSame(i.leaf, main.leaf) ? i.short : i.leaf, y = ccSame(i.leaf, main.leaf) ? main.short : main.leaf;
        // two different Amazon categories (by id) that are written the very same way: said so, with the two ids
        const text = x === y ? `This child is in another Amazon category with the same name as its family's: ${x} (category ${i.idKey}, its family is in ${main.idKey}).`
          : `This child is in ${x}, its family is in ${y}.`;
        r.probs.push({ k: 'mixed', text, hint: `Shoppers browsing ${y} won't see it. Ask Amazon to move it, or mark it 'Correct on purpose'.` });
      }
      // a mismatch only when Amazon ranks it and NONE of its category ranks is on its browse path
      if (i.state === 'ok' && i.ranks.length && !i.rankOn)
        r.probs.push({ k: 'rank', text: `Ranked in ${i.sub.c}, listed in ${i.leaf}.`, hint: CC_HINT.rank });
      const mark = (CC.ok[r.c.brand] || {})[ccId(r.c)];
      if (mark && mark.on && r.probs.length) { r.marked = mark; r.okProbs = r.probs; r.probs = []; }
    });
    return { f: { fk: f.fk, brand: f.brand, name: f.name, psku: f.psku, pa: f.pa, solo: f.solo, n: rows.length }, rows, main,
      catState: main ? 'ok' : rows.some(r => r.info.state === 'none') ? 'none' : 'unread',
      errs: rows.filter(r => r.probs.some(p => CC_SEV[p.k] === 'r')).length, checks: rows.filter(r => r.probs.length && !r.probs.some(p => CC_SEV[p.k] === 'r')).length };
  });
  // most errors first, then by name — fixed while the data is the same, so marking a row never moves a family under the mouse
  const orderKey = lmV + '|' + groups.length;
  if (!CC.order || CC.orderKey !== orderKey) {
    CC.order = new Map(groups.slice().sort((a, b) => b.errs - a.errs || b.checks - a.checks || String(a.f.name).localeCompare(String(b.f.name)) || a.f.fk.localeCompare(b.f.fk)).map((g, i) => [g.f.fk, i]));
    CC.orderKey = orderKey;
  }
  groups.sort((a, b) => (CC.order.has(a.f.fk) ? CC.order.get(a.f.fk) : 1e9) - (CC.order.has(b.f.fk) ? CC.order.get(b.f.fk) : 1e9));
  CC.view = { groups, live, unread, usable, src: v, lmV, okV: CC.okV, notes: v.notes || [], all: v.all };
  return CC.view;
}
// Does this row belong under the filter? '' = every live child; an error kind = the rows with that error; 'ok' = the rows marked correct.
const ccRowIn = (r, f) => (!f ? true : f === 'ok' ? !!r.marked : r.probs.some(p => p.k === f));
/** The families the brand, the search and the filter keep, each with the rows they keep. */
function ccGroups(view, f) {
  const q = fcNorm(CC.q);
  const filter = f === undefined ? CC.f : f;
  return view.groups.filter(g => CC.brand === 'ALL' || g.f.brand === CC.brand).map(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q) || (g.main && fcNorm(g.main.full).includes(q)));
    const rows = g.rows.filter(r => ccRowIn(r, filter) && (!q || famHit || (r.c.skus || [r.c.sku]).some(x => fcNorm(x).includes(q)) || fcNorm(r.c.asin).includes(q)
      || fcNorm(r.info.full).includes(q) || fcNorm(ccBsr(r.info)).includes(q)));
    return rows.length ? { f: g.f, main: g.main, catState: g.catState, all: g.rows, rows } : null;
  }).filter(Boolean);
}
// A card's / chip's number, within the brand and the search (the filter itself is not a filter on its own count).
const ccCount = (view, k) => ccGroups(view, k).reduce((sum, g) => sum + g.rows.length, 0);

/* ----- drawing ----- */
// The Categories tab's own controls in the shared toolbar (the Families ones are hidden): brand, search, Open all / Close all, Export CSV.
function ccTools() {
  if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('#fcPane .fc-famonly').forEach(el => { el.classList.add('hide'); if (el.style) el.style.display = 'none'; });   // (a button's own display rule beats .hide; the shell is rebuilt when the tab changes)
  const pane = $('fcPane');
  if (!pane || !pane.querySelector || pane.querySelector('[data-cc-f="q"]')) return;
  const bar = pane.querySelector('.toolbar');
  if (!bar || !bar.insertAdjacentHTML) return;
  const left = `<select data-cc-f="brand" aria-label="Brand"><option value="ALL">Both brands</option><option value="SP">Ridhi</option><option value="CPC">CPC</option></select>`
    + `<input type="search" class="cc-q" data-cc-f="q" placeholder="Search SKU, ASIN, family or category" aria-label="Search" value="${fcEsc(CC.q)}">`;
  const right = '<button type="button" class="ghost" data-cc="openall">Open all</button><button type="button" class="ghost" data-cc="closeall">Close all</button>'
    + '<button type="button" class="ghost" data-cc="csv">Export CSV</button>';
  const spacer = bar.querySelector('span[style*="flex:1"]');
  if (spacer && spacer.insertAdjacentHTML) spacer.insertAdjacentHTML('beforebegin', left);
  else bar.insertAdjacentHTML('beforeend', left);
  bar.insertAdjacentHTML('beforeend', right);
  const sel = pane.querySelector('[data-cc-f="brand"]');
  if (sel) sel.value = CC.brand;
}
function ccMetaHtml(view) {
  const parts = [`Live children only (buyable and in stock): ${fcNf(view.live)} of ${fcNf(view.all)} ASINs`, 'categories and ranks from Amazon\'s catalog only (the Amazon auto refresh)'];
  const wait = !view.usable ? 'Amazon\'s category data is not here right now (the auto refresh has not been read, or is older than 24 hours) — categories show as "not read yet" and nothing is flagged.'
    : view.unread ? `${fcNf(view.unread)} live ASIN${view.unread === 1 ? ' is' : 's are'} not in the Amazon data yet — shown as "Category not read yet", not counted.` : '';
  return parts.map(fcEsc).join(' · ') + (wait ? `<div>${fcEsc(wait)}</div>` : '') + view.notes.map(n => `<div>${fcEsc(n)}</div>`).join('')
    + (CC.okNote ? `<div class="fc-oknote">${fcEsc(CC.okNote)}</div>` : '');
}
// A child's category cell: the short path (the whole path on hover), or the grey word for none / not read.
const ccCatHtml = info => (info.state === 'ok' ? `<span class="cc-path" title="${fcEsc(info.full)}">${fcEsc(info.short)}</span>`
  : info.state === 'none' ? '<span class="fc-none">no category</span>' : '<span class="fc-chip is-g cc-unread">Category not read yet</span>');
function ccPicHtml(info) {
  const url = info.pic ? (typeof imThumb === 'function' ? imThumb(info.pic) : info.pic) : '';
  return url ? `<img class="cc-pic" src="${fcEsc(url)}" alt="" loading="lazy" decoding="async">` : '<span class="cc-pic is-none" aria-hidden="true"></span>';
}
function ccRowHtml(r) {
  const c = r.c, i = r.info;
  const a = `data-cc-b="${fcEsc(c.brand)}" data-cc-s="${fcEsc(ccId(c))}"`;
  const tick = r.probs.length ? `<input type="checkbox" class="fc-tick" data-cc="tick" ${a}${CC.sel.has(r.key) ? ' checked' : ''} aria-label="Tick ${fcEsc(c.sku)}">` : '';
  const amz = c.asin ? `<a href="https://www.amazon.com/dp/${fcEsc(c.asin)}" target="_blank" rel="noopener" title="Open on Amazon in a new tab">${fcEsc(c.asin)}</a>` : '—';
  const bsr = ccBsr(i);
  let prob, acts = '';
  if (r.probs.length) {
    prob = r.probs.map(p => `<div class="fc-p is-${CC_SEV[p.k]}">${fcEsc(p.text)}</div><small class="cc-hint"><b>What to do:</b> ${fcEsc(p.hint)}</small>`).join('');
    acts = `<button type="button" class="ghost fc-b" data-cc="ok" ${a}>Correct on purpose</button>`;
  } else if (r.marked) {
    prob = `<span class="fc-chip is-g cc-marked">Correct on purpose</span>` + (CC.f === 'ok' ? r.okProbs.map(p => `<div class="fc-p is-g">${fcEsc(p.text)}</div>`).join('')
      + `<small class="cc-hint">Marked by ${fcEsc(r.marked.name || fcName(r.marked.by))}${r.marked.at ? ' · ' + fcEsc(fcWhen(r.marked.at)) : ''}</small>` : '');
    if (CC.f === 'ok') acts = `<button type="button" class="ghost fc-b" data-cc="undo" ${a}>Undo</button>`;
  } else if (i.state === 'unread') prob = '<span class="fc-none">not checked</span>';
  else prob = '<span class="cc-tick" title="In the right category">✓</span>';
  // the red bar down the side: an error row; a row with only a Rank mismatch (a check) gets the amber one
  const bar = r.probs.some(p => CC_SEV[p.k] === 'r') ? ' is-orphan' : r.probs.length ? ' cc-chk' : '';
  return `<tr class="fc-row${bar}${CC.sel.has(r.key) ? ' is-sel' : ''}"><td class="fc-tk">${tick}</td><td class="cc-pc">${ccPicHtml(i)}</td>`
    + `<td class="fc-sku"><b>${fcEsc(c.sku)}</b>${typeof lmOldHtml === 'function' ? lmOldHtml(c.brand, c.sku) : ''}<small>${fcEsc(String(c.title || '').slice(0, 70))}</small></td>`
    + `<td class="ui-mono">${amz}</td><td class="cc-cat">${ccCatHtml(i)}</td><td class="cc-bsr">${bsr ? fcEsc(bsr) : '<span class="fc-none">no rank</span>'}</td>`
    + `<td class="fc-prob cc-prob">${prob}</td><td class="fc-acts">${acts}</td></tr>`;
}
const CC_COLHEAD = '<tr class="fc-colh"><th class="fc-tk"></th><th></th><th>SKU</th><th>ASIN</th><th>Category</th><th>Best-seller rank</th><th>Check</th><th></th></tr>';
// One family: a single line while closed (its category and its error chips); open, the column header and its children's rows.
function ccGroupHtml(g) {
  const f = g.f, open = CC.open.has(f.fk);
  const n = k => g.all.filter(r => r.probs.some(p => p.k === k)).length;
  const chips = CC_KINDS.map(k => (n(k.k) ? `<span class="fc-chip is-${k.sev}">${fcNf(n(k.k))} ${fcEsc(k.t.toLowerCase())}</span>` : '')).join('');
  const marked = g.all.filter(r => r.marked).length;
  const cat = g.catState === 'ok' ? `<span class="cc-path cc-fcat" title="${fcEsc(g.main.full)}">${fcEsc(g.main.short)}</span>`
    : g.catState === 'none' ? '<span class="fc-chip is-g">no category</span>' : '<span class="fc-chip is-g cc-unread">Category not read yet</span>';
  const errKeys = g.rows.filter(r => r.probs.length).map(r => r.key);
  const allOn = errKeys.length && errKeys.every(k => CC.sel.has(k));
  const selAll = open && errKeys.length ? ` <button type="button" class="ghost fc-b fc-selall" data-cc="selfam" data-cc-v="${fcEsc(f.fk)}">${allOn ? 'Clear this family' : 'Select all in family'}</button>` : '';
  return `<tbody class="fc-grp${open ? ' is-open' : ''}"><tr class="fc-head" data-cc="grp" data-cc-v="${fcEsc(f.fk)}" tabindex="0" aria-expanded="${open}"><td colspan="${CC_COLS}">`
    + `<button type="button" class="fc-arrow" data-cc="grp" data-cc-v="${fcEsc(f.fk)}" aria-label="${open ? 'Close' : 'Open'} ${fcEsc(f.name)}">${open ? '▾' : '▸'}</button>`
    + `<b>${fcEsc(f.name)}</b> <small class="muted">${fcEsc(fcBrandName(f.brand))} · ${f.solo ? '1 live listing, no family' : fcNf(f.n) + ' live child' + (f.n === 1 ? '' : 'ren')}</small> ${cat}${chips}`
    + (marked ? `<span class="fc-chip is-g">${fcNf(marked)} correct on purpose</span>` : '') + selAll + '</td></tr>'
    + (open ? CC_COLHEAD + g.rows.map(ccRowHtml).join('') : '') + '</tbody>';
}
// The bar while something is ticked: "N selected · [Mark correct on purpose (N)] [Clear]".
function ccBarHtml(view) {
  const live = new Set();
  view.groups.forEach(g => g.rows.forEach(r => { if (r.probs.length) live.add(r.key); }));
  [...CC.sel].forEach(k => { if (!live.has(k)) CC.sel.delete(k); });      // a tick whose row is no longer an error is dropped
  if (!CC.sel.size) return '';
  return `<div class="fc-bar" role="region" aria-label="Ticked listings"><b>${fcNf(CC.sel.size)} selected</b>`
    + `<button type="button" class="fc-b" data-cc="bok">Mark correct on purpose (${fcNf(CC.sel.size)})</button><button type="button" class="fc-b ghost" data-cc="bclear">Clear</button></div>`;
}
// "N marked correct › Show": every marked child still live and still with something the mark hides, with who / when and Undo.
function ccMarkedHtml(view) {
  const rows = [];
  ccGroups(view, 'ok').forEach(g => g.rows.forEach(r => rows.push({ g, r })));
  if (!rows.length) return '';
  return `<div class="fc-rem"><button type="button" class="fc-link" data-cc="showok" aria-expanded="${CC.showOk}">${fcNf(rows.length)} marked correct › ${CC.showOk ? 'Hide' : 'Show'}</button>`
    + (CC.showOk ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl"><thead><tr><th>SKU</th><th>ASIN</th><th>Family</th><th>What it would say</th><th>Who · when</th><th></th></tr></thead><tbody>${rows.map(({ g, r }) =>
      `<tr><td><b>${fcEsc(r.c.sku)}</b></td><td class="ui-mono">${fcEsc(r.c.asin || '—')}</td><td>${fcEsc(g.f.name)}</td><td>${r.okProbs.map(p => fcEsc(p.text)).join('<br>')}</td>`
      + `<td>${fcEsc(r.marked.name || fcName(r.marked.by))} · ${fcEsc(r.marked.at ? fcWhen(r.marked.at) : '')}</td>`
      + `<td><button type="button" class="ghost fc-b" data-cc="undo" data-cc-b="${fcEsc(r.c.brand)}" data-cc-s="${fcEsc(ccId(r.c))}">Undo</button></td></tr>`).join('')}</tbody></table></div>` : '') + '</div>';
}
function ccBodyHtml(view) {
  const counts = Object.fromEntries(CC_KINDS.map(k => [k.k, ccCount(view, k.k)]));
  const okN = ccCount(view, 'ok');
  const errors = counts.mixed + counts.none + counts.rank;
  const box = (k, t, n, word, cls, tip) => `<button type="button" class="fc-box${cls}${CC.f === k ? ' is-on' : ''}" data-cc="f" data-cc-v="${k}" aria-pressed="${CC.f === k}" title="${fcEsc(tip)}">`
    + `<span>${fcEsc(t)}</span><b>${fcNf(n)}</b><small>${word}</small></button>`;
  const cards = CC_KINDS.map(k => box(k.k, k.t, counts[k.k], k.sev === 'r' ? 'error' : 'check', ' is-' + k.sev, k.tip)).join('')
    + box('ok', 'Correct on purpose', okN, 'hidden', ' is-g', 'Children the team marked as in the right place on purpose: they never show as errors.');
  const chip = (k, t, n) => `<button type="button" class="cc-fchip${CC.f === k ? ' is-on' : ''}" data-cc="chip" data-cc-v="${k}" aria-pressed="${CC.f === k}">${fcEsc(t)}${n == null ? '' : ` <b>${fcNf(n)}</b>`}</button>`;
  const chips = `<div class="cc-chips" role="group" aria-label="Show">${chip('', 'All')}${CC_KINDS.map(k => chip(k.k, k.t, counts[k.k])).join('')}${chip('ok', 'Correct on purpose', okN)}</div>`;
  const groups = ccGroups(view);
  const shown = groups.slice(0, CC.limit);
  const more = groups.length - shown.length;
  const judged = view.live - view.unread;
  // the empty states: nothing to check, nothing read yet, or — the good one — nothing wrong
  let note = '';
  if (!view.live) note = '<div class="card fc-empty"><b>No live children to check</b> — the snapshots are empty or nothing is buyable and in stock.</div>';
  else if (!judged) note = '<div class="card fc-empty"><b>Category not read yet</b><p class="muted">Amazon\'s category data has not been read for these listings. Nothing is flagged; the list below shows what is live.</p></div>';
  else if (!errors && !CC.q && CC.f !== 'ok') note = '<div class="card fc-empty cc-allok"><b>All live products are in the right category ✓</b></div>';
  else if (!groups.length) note = `<div class="card fc-empty">${CC.f === 'ok' ? '<b>Nothing is marked correct on purpose</b>' : CC.f ? `<b>No ${fcEsc(CC_KINDS.find(k => k.k === CC.f).t.toLowerCase())}</b>` : '<b>Nothing matches</b>'}${CC.q || CC.brand !== 'ALL' ? ' with these filters.' : '.'}</div>`;
  const table = groups.length ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl cc-tbl">${shown.map(ccGroupHtml).join('')}</table></div>`
    + (more ? `<div class="fc-more" id="ccMore"><button type="button" class="ghost" data-cc="more">Show more families (${fcNf(more)} left)</button></div>` : '') : '';
  return `<div class="fc-boxes">${cards}</div>${chips}${note}${table}${ccBarHtml(view)}${ccMarkedHtml(view)}`;
}
/** The Categories tab (family-check.js fcDrawAll hands it over). Everything comes from memory: no network wait. */
function ccDraw() {
  if (!$('fcBody')) return;
  ccTools();
  ccOkLoad();
  if (FC.loading && !FC.loaded) { $('fcBody').innerHTML = '<div class="card fc-empty muted">Reading the Listing Health and Image Manager snapshots…</div>'; return; }
  const view = ccBuild();
  if ($('fcMeta')) $('fcMeta').innerHTML = ccMetaHtml(view);
  $('fcBody').innerHTML = ccBodyHtml(view);
  ccWatchMore();
}
// "Show more" comes in by itself when it scrolls near the screen.
function ccWatchMore() {
  if (typeof IntersectionObserver !== 'function') return;
  if (!CC.io) CC.io = new IntersectionObserver(seen => { if (FC.tab === 'cat' && seen.some(e => e.isIntersecting)) { CC.limit += CC_STEP; ccDraw(); } }, { rootMargin: '400px' });
  CC.io.disconnect();
  const more = $('ccMore');
  if (more) CC.io.observe(more);
}
/** Open or close one family; the clicked line stays where it was on the screen. Its children come from memory. */
function ccToggle(fk, el) {
  const line = el && el.closest ? el.closest('.fc-head') || el : null;
  const top0 = line && line.getBoundingClientRect ? line.getBoundingClientRect().top : null;
  if (CC.open.has(fk)) CC.open.delete(fk);
  else CC.open.add(fk);
  ccDraw();
  if (top0 == null || typeof document === 'undefined' || !document.querySelector) return;
  const again = document.querySelector(`#fcBody .fc-head[data-cc-v="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(fk) : fk}"]`);
  if (again && again.getBoundingClientRect && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, again.getBoundingClientRect().top - top0);
}

/* ----- the CSV: what is in view ----- */
const CC_CSV_COLS = ['Brand', 'Family', 'SKU', 'ASIN', 'Browse path', 'BSR', 'Error', 'What to do'];
function ccCsv(view) {
  const q = val => { const s = String(val == null ? '' : val); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [];
  ccGroups(view || ccBuild()).forEach(g => g.rows.forEach(r => {
    const base = [fcBrandName(r.c.brand), g.f.name, (r.c.skus || [r.c.sku]).join(' / '), r.c.asin, r.info.state === 'ok' ? r.info.full : r.info.state === 'none' ? '' : 'Category not read yet', ccBsr(r.info)];
    const probs = r.probs.length ? r.probs : r.marked ? r.okProbs.map(p => ({ text: 'Correct on purpose: ' + p.text, hint: '' })) : [{ text: '', hint: '' }];
    probs.forEach(p => lines.push(base.concat([p.text, p.hint]).map(q).join(',')));
  }));
  return { n: lines.length, text: '﻿' + [CC_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function ccDownload() {
  const out = ccCsv(ccBuild());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-category-check-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}

/* ----- the numbers per brand (the browser console) ----- */
/** ccReport(): on the data this page holds — per brand, the live children, the families, each error's count, the children not read yet and
 *  the ones marked correct. Open Family & Category Check once first (it reads the snapshots). */
function ccReport() {
  const view = ccBuild();
  const out = {};
  ['SP', 'CPC'].forEach(b => {
    const gs = view.groups.filter(g => g.f.brand === b);
    const rows = gs.flatMap(g => g.rows);
    const n = k => rows.filter(r => r.probs.some(p => p.k === k)).length;
    out[fcBrandName(b)] = { families: gs.filter(g => !g.f.solo).length, liveChildren: rows.length, mixedCategory: n('mixed'), noCategory: n('none'), rankMismatch: n('rank'),
      correctOnPurpose: rows.filter(r => r.marked).length, notReadYet: rows.filter(r => r.info.state === 'unread').length, cacheUsable: typeof lmOk === 'function' && lmOk(b) };
  });
  if (typeof console !== 'undefined' && console.table) console.table(out);
  return out;
}
if (typeof window !== 'undefined') window.ccReport = ccReport;

/* ----- events ----- */
function ccClick(el) {
  const act = el.dataset.cc, v = el.dataset.ccV, brand = el.dataset.ccB, id = el.dataset.ccS;
  if (act === 'f') { CC.f = CC.f === v ? '' : v; CC.limit = CC_STEP; return ccDraw(); }             // a card: press again to clear it
  if (act === 'chip') { CC.f = v || ''; CC.limit = CC_STEP; return ccDraw(); }
  if (act === 'grp') return ccToggle(v, el);
  if (act === 'openall') { ccGroups(ccBuild()).forEach(g => CC.open.add(g.f.fk)); return ccDraw(); }
  if (act === 'closeall') { CC.open.clear(); return ccDraw(); }
  if (act === 'more') { CC.limit += CC_STEP; return ccDraw(); }
  if (act === 'csv') return ccDownload();
  if (act === 'ok') return ccOkSetMany([fcKey(brand, id)]);
  if (act === 'undo') return ccOkUndo(brand, id);
  if (act === 'showok') { CC.showOk = !CC.showOk; return ccDraw(); }
  if (act === 'tick') { const k = fcKey(brand, id); if (CC.sel.has(k)) CC.sel.delete(k); else CC.sel.add(k); return ccDraw(); }
  if (act === 'selfam') {
    const g = ccGroups(ccBuild()).find(x => x.f.fk === v);
    const keys = g ? g.rows.filter(r => r.probs.length).map(r => r.key) : [];
    const allOn = keys.length && keys.every(k => CC.sel.has(k));
    keys.forEach(k => (allOn ? CC.sel.delete(k) : CC.sel.add(k)));
    return ccDraw();
  }
  if (act === 'bclear') { CC.sel.clear(); return ccDraw(); }
  if (act === 'bok') return ccOkSetMany([...CC.sel]);
}
function ccFilter(el) {
  const k = el.dataset.ccF;
  CC[k] = el.value;
  CC.limit = CC_STEP;
  clearTimeout(CC.qT);
  if (k === 'q') CC.qT = setTimeout(ccDraw, 250);
  else ccDraw();
}
if (typeof document !== 'undefined' && document.addEventListener && $('fcPane')) {
  $('fcPane').addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-cc]') : null;
    if (el && !el.disabled) ccClick(el);
  });
  $('fcPane').addEventListener('keydown', e => {
    const t = e.target && e.target.dataset ? e.target : null;
    if (t && (e.key === 'Enter' || e.key === ' ') && t.dataset.cc === 'grp' && t.tagName !== 'BUTTON') { e.preventDefault(); ccClick(t); }
  });
  $('fcPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.ccF) ccFilter(e.target); });
  $('fcPane').addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.ccF === 'q') ccFilter(e.target); });
}
