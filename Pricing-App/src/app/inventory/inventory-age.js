/* ================= INVENTORY · INVENTORY AGE: how old the FBA stock is, per parent or per SKU =================
 * Screens: Inventory Age (tab 'age'; core/nav.js calls ensureAge when it opens), in the Ad Console look (.ag-* in
 * styles.css). A meta line with each brand's snapshot time (ageWhen); the toolbar card with the Parent ASINs / Child ASINs
 * view pills (ageViewParent, ageViewChild), the brand picker (ageBrandView: Ridhi, CPC or both), the search box
 * (ageFilter), Export (ageCsv) and Refresh both brands (ageGo); ageMsg is its message line. Below it: five number boxes
 * that also set the table's focus (ageKpis), the age mix bars (ageMix), and the table card — its title (ageTitle,
 * ageSub), the focus pills (ageFocusSeg: all / aged 181+ / over a year / healthy) and the table (ageTable), whose parent
 * rows open to their SKUs.
 * Does: keeps the last ageing snapshot per brand in Firestore (age/SP, age/CPC) so the tab opens already populated
 * (loadAgeCache, saveAgeCache). Refresh asks the backend (baCall, in sales/brand-analytics.js) to create Amazon's
 * FBA inventory age report for each brand, polls until it is ready, caches it and redraws. The report's overlapping
 * day buckets are reduced to the non-overlapping set (ageRange, totalCols); only buckets starting at AGED_FROM days
 * count as "aged". renderAge draws the table in the chosen view (children rolled up per parent, shown with the
 * hand-corrected parent names from Listing audit — PNAME, AUDIT_MANUAL — or one row per SKU), applies the filter
 * and the clicked sort, the focus and the opened parents; renderAgeKpis and renderAgeMix build the boxes and the mix
 * from the same rows; Export downloads exactly what is on screen as a CSV.
 * Main functions: ageMsg, ageRange, totalCols, loadAgeCache, saveAgeCache, ensureAge, renderAge, renderAgeWhen,
 * renderAgeKpis, renderAgeMix, ageBucketCls, prettyAge, and the Refresh both brands (ageGo) and Export (ageCsv) handlers. */

/* ---------- FBA inventory age ---------- */
// Snapshots are CACHED in Firestore (age/SP, age/CPC) so the tab opens already populated; the
// Refresh button is the only thing that goes back to Amazon, and it does BOTH brands in one go.
// The snapshot per brand: { cols, rows, at } — null until loaded.
const AGE = { SP: null, CPC: null };
// Brand key → the name shown on screen.
const BRAND_NAME = { SP: 'Ridhi', CPC: 'CPC' };
// AGE_VIEW: 'parent' (children rolled up) or 'child' (one row per SKU). AGE_LOADED: the cache has been read once.
let AGE_VIEW = 'parent', AGE_LOADED = false;
// "Aged" = genuinely old stock, not everything on hand. Only buckets STARTING at this many days
// count toward the total; 0-90 and 91-180 are healthy inventory and are shown but not totalled.
const AGED_FROM = 181;
let AGE_SORT = { k: '_t', dir: -1 };          // clicked column + direction
let AGE_RENDER = { rows: [], defs: [], val: () => '' };   // last rendered view, for the CSV export

// Write the message line under the toolbar; bad = true shows it in red (class err), otherwise muted.
function ageMsg(t, bad) {
  const m = $('ageMsg');
  m.textContent = t;
  m.className = bad ? 'err' : 'muted';
}

/**
 * Amazon ships OVERLAPPING age buckets (e.g. 0-to-90 alongside 0-to-30 / 31-to-60 / 61-to-90).
 * Summing every column double-counts — which is why a total could exceed the units on hand. Parse
 * each column's day range and keep only the finest set that doesn't overlap; those are what's totalled.
 */
// Parse one column header's day range: "inv-age-0-to-90-days" → [0, 90], "365-plus" → [365, Infinity];
// null when the header has no range.
function ageRange(h) {
  // Normalise separators first — "inv-age-0-to-90-days" has hyphens AROUND the "to".
  const s = String(h).replace(/[^a-z0-9]+/gi, ' ').toLowerCase().trim();
  let m = s.match(/(\d+)\s*(?:to|through)\s*(\d+)/);
  if (m) return [+m[1], +m[2]];
  m = s.match(/(\d+)\s*(?:plus|\+|and over|older)/);
  return m ? [+m[1], Infinity] : null;
}
// From all the age column headers keep only the non-overlapping buckets (the widest ones), sorted by start day.
function totalCols(cols) {
  const span = r => (r[1] === Infinity ? 1e9 : r[1] - r[0]);
  const parsed = cols.map(c => ({ c, r: ageRange(c) })).filter(x => x.r);
  // COARSEST first: Amazon ships both wide buckets (0-90) and narrow ones (0-30/31-60/61-90). Either
  // set totals the same, so prefer the wide ones — that's the 6-column view the report itself shows.
  parsed.sort((a, b) => span(b.r) - span(a.r));
  const keep = [];
  for (const p of parsed) if (!keep.some(q => p.r[0] < q.r[1] && q.r[0] < p.r[1])) keep.push(p);
  return keep.sort((a, b) => a.r[0] - b.r[0]).map(x => x.c);
}

/* ----- Firestore cache ----- */
// Read both brands' cached snapshots (age/SP, age/CPC) into AGE, expanding the compact keys saveAgeCache wrote.
async function loadAgeCache() {
  for (const b of ['SP', 'CPC']) {
    try {
      // --- load data ---
      const snap = await getDoc(doc(db, 'age', b));
      if (!snap.exists()) continue;
      const d = snap.data(), cols = d.cols || [];
      // --- expand the compact row keys (see saveAgeCache) ---
      AGE[b] = {
        cols,
        at: d.at && d.at.toDate ? d.at.toDate() : null,
        rows: (d.rows || []).map(r => ({
          sku: r.s,
          asin: r.i,
          parent: r.p,
          product: r.n,
          available: r.v,
          storage: r.g || 0,
          age: Object.fromEntries(cols.map((c, k) => [c, (r.a || [])[k] || 0])),
        })),
      };
    } catch (e) { /* no cache yet — the tab just starts empty */ }
  }
  AGE_LOADED = true;
}
// Write one brand's snapshot to Firestore age/{brand} with compact keys and at most 1500 rows.
async function saveAgeCache(brand, cols, rows) {
  await setDoc(doc(db, 'age', brand), {
    cols,
    rows: rows.slice(0, 1500).map(r => ({                 // compact keys + capped, to stay under 1 MB
      s: r.sku,
      i: r.asin || '',
      p: r.parent || '',
      n: (r.product || '').slice(0, 40),
      v: r.available || 0,
      g: r.storage || 0,
      a: cols.map(c => (r.age && r.age[c]) || 0),
    })),
    at: serverTimestamp(),
  });
}
// Called when the tab opens: load the parent names, then the cached snapshots (first time only), and draw.
async function ensureAge() {
  // Parent names corrected by hand live in Listing audit (parentnames + manually-added parents);
  // load them so this tab shows the same names, not the raw Amazon product string.
  await loadParentNames();
  await loadManualParents();
  if (AGE_LOADED) return renderAge();
  ageMsg('Loading the last snapshot…');
  await loadAgeCache();
  ageMsg('');
  renderAge();
}

/* ----- Refresh (both brands) ----- */
// Refresh both brands: for each brand ask Amazon for a fresh ageing report, poll until it is ready, cache it
// and redraw; failures are collected and shown at the end.
$('ageGo').onclick = async () => {
  // --- busy ---
  $('ageGo').disabled = true;
  $('ageGo').innerHTML = '<span class="spin"></span>Refreshing…';
  const failed = [];
  // --- one brand at a time: create the report, poll, cache, draw ---
  for (const brand of ['SP', 'CPC']) {
    try {
      ageMsg(`${BRAND_NAME[brand]}: asking Amazon to build the ageing report…`);
      const c = await baCall({ age: 'create', brand });
      if (!c.reportId) throw new Error(c.error || 'could not create report');
      let done = null;
      for (let i = 0; i < 32 && !done; i++) {                       // ~8 min ceiling per brand
        await new Promise(r => setTimeout(r, i === 0 ? 8000 : 15000));
        const d = await baCall({ age: 'poll', id: c.reportId, brand });
        if (d.status === 'done') done = d;
        else ageMsg(`${BRAND_NAME[brand]}: report building… (${Math.round((i * 15 + 8) / 6) / 10} min)`);
      }
      if (!done) throw new Error('report took too long');
      const cols = done.ageCols || [], rows = done.rows || [];
      AGE[brand] = { cols, rows, at: new Date() };
      await saveAgeCache(brand, cols, rows);
      renderAge();
    } catch (e) { failed.push(`${BRAND_NAME[brand]}: ${e.message || e}`); }
  }
  AGE_LOADED = true;
  // --- report what failed ---
  // Amazon's Reports API allows roughly ONE report per minute, so back-to-back refreshes hit a 429.
  // Say that plainly instead of dumping the raw SP-API error — the cached snapshot is still on screen.
  const quota = failed.some(f => /429|QuotaExceeded/i.test(f));
  ageMsg(quota
    ? 'Amazon’s report quota is used up (it allows about one report a minute). '
      + 'Wait ~10 minutes and refresh again — the snapshot below is the last successful pull.'
    : failed.join('  ·  '), failed.length > 0);
  // --- back to normal ---
  $('ageGo').disabled = false;
  $('ageGo').textContent = 'Refresh both brands';
};

// Toolbar events: typing in the filter or changing the brand redraws; the two view buttons switch the view.
$('ageFilter').addEventListener('input', renderAge);
$('ageBrandView').addEventListener('change', renderAge);
$('ageViewParent').onclick = () => { AGE_VIEW = 'parent'; renderAge(); };
$('ageViewChild').onclick = () => { AGE_VIEW = 'child'; renderAge(); };

// AGE_FOCUS: which rows the table shows — 'all', 'aged' (some stock 181+ days), 'year' (some stock 366+ days) or 'healthy'
// (nothing past 180 days). The number boxes and the pills over the table both set it.
// AGE_OPEN: the parent rows opened to their SKUs, keyed parent|brand.
let AGE_FOCUS = 'all';
const AGE_OPEN = new Set();
// "Over a year" = buckets STARTING at this many days (366-455, 456+); 331-365 is still under a year.
const AGE_YEAR_FROM = 366;
$('ageFocusSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (b) { AGE_FOCUS = b.dataset.f; renderAge(); }
});

// The colour an age bucket wears, by its first day, green → red: ag-b0 0-90 … ag-b5 456+ (styles.css, INVENTORY AGE).
function ageBucketCls(c) {
  const r = ageRange(c), d = r ? r[0] : 0;
  return 'ag-b' + (d < 91 ? 0 : d < 181 ? 1 : d < 331 ? 2 : d < AGE_YEAR_FROM ? 3 : d < 456 ? 4 : 5);
}
// Shared formatters for this tab.
const ageNf = v => Number(v || 0).toLocaleString('en-US');
const ageUsd = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ageEsc = s => String(s == null ? '' : s)
  .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const agePct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// The meta line's right side: when each brand on screen was last pulled; amber once older than a week.
function renderAgeWhen(pick) {
  const list = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  $('ageWhen').innerHTML = list.map(b => {
    const at = AGE[b] && AGE[b].at;
    if (!at) return `<span>${BRAND_NAME[b]}: no snapshot yet</span>`;
    const old = Date.now() - at.getTime() > 7 * 864e5;
    const t = at.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<span class="${old ? 'is-old' : ''}" title="${ageEsc(at.toLocaleString())}">${BRAND_NAME[b]} updated <b>${t}</b></span>`;
  }).join('  ·  ');
}

// Draw the whole screen from AGE: the meta line, the number boxes, the age mix and the table for the chosen brands, view,
// search, focus and sort.
function renderAge() {
  // --- view buttons and focus pills ---
  $('ageViewParent').classList.toggle('on', AGE_VIEW === 'parent');
  $('ageViewChild').classList.toggle('on', AGE_VIEW === 'child');
  $('ageFocusSeg').querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', b.dataset.f === AGE_FOCUS));

  // --- which brands; the first-run card when nothing is cached yet ---
  const pick = $('ageBrandView').value;
  renderAgeWhen(pick);
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => AGE[b]);
  if (!brands.length) {
    $('ageResult').classList.remove('hide');
    $('ageKpis').innerHTML = '<div class="ag-first"><b>No snapshot yet</b>Hit “Refresh both brands” to pull the FBA '
      + 'inventory age report from Amazon. It takes a few minutes per brand; after that the tab opens straight away.</div>';
    $('ageMix').classList.add('hide');
    $('ageMix').innerHTML = '';
    $('ageTitle').textContent = '';
    $('ageSub').textContent = '';
    $('ageTable').innerHTML = '';
    return;
  }

  // --- the age columns, the "aged" and "over a year" totals ---
  // Only the non-overlapping buckets are shown AND totalled — the redundant narrow ones are dropped.
  const allCols = [...new Set(brands.flatMap(b => AGE[b].cols))];
  const cols = totalCols(allCols);
  const startOf = c => { const r = ageRange(c); return r ? r[0] : 0; };
  const agedCols = cols.filter(c => startOf(c) >= AGED_FROM);
  const yearCols = cols.filter(c => startOf(c) >= AGE_YEAR_FROM);
  const sumOf = (r, cs) => cs.reduce((s, c) => s + (r.age[c] || 0), 0);
  const stamp = r => {
    r._t = sumOf(r, agedCols);
    r._y = sumOf(r, yearCols);
    r._b = sumOf(r, cols);                                        // every unit in a bucket — the age mix's whole
    r._p = r.available ? r._t / r.available : 0;                  // aged share of what is available
    return r;
  };
  const multiBrand = brands.length > 1;
  const unit = AGE_VIEW === 'parent' ? 'parents' : 'SKUs';

  // --- rows: one per SKU, each tagged with its brand ---
  let rows = brands.flatMap(b => AGE[b].rows.map(r => ({ ...r, brand: b })));

  if (AGE_VIEW === 'parent') {                                   // roll children up into their parent
    const g = {};
    rows.forEach(r => {
      const key = (r.parent || r.asin || r.sku) + '|' + r.brand;
      const o = g[key] || (g[key] = {
        key,
        parent: r.parent || r.asin || '—',
        brand: r.brand,
        product: r.product,
        children: 0,
        available: 0,
        storage: 0,
        age: {},
        kids: [],
      });
      o.children++;
      o.available += r.available || 0;
      o.storage += r.storage || 0;
      o.kids.push(r);
      cols.forEach(c => { o.age[c] = (o.age[c] || 0) + (r.age[c] || 0); });
    });
    // Show the hand-corrected parent name (from Listing audit) in the Product column when there is
    // one; otherwise keep the Amazon product string this snapshot already holds.
    Object.values(g).forEach(o => {
      const fixed = PNAME[o.brand]?.[o.parent]?.v || AUDIT_MANUAL?.[o.brand]?.[o.parent]?.name;
      if (fixed) o.product = fixed;
    });
    rows = Object.values(g);
  }

  // --- search, then the totals per row ---
  // The boxes and the age mix are built from these rows (search applied, focus not), so clicking a box never moves the boxes.
  const q = $('ageFilter').value.trim().toLowerCase();
  if (q) rows = rows.filter(r => ((r.sku || '') + ' ' + (r.asin || '') + ' ' + (r.parent || '') + ' '
    + (r.product || '') + ' ' + (r.kids || []).map(k => k.sku + ' ' + (k.asin || '')).join(' ')).toLowerCase().includes(q));
  rows.forEach(stamp);

  // --- focus: what the table shows ---
  const FOCUS = {
    all: () => true,
    aged: r => r._t > 0,
    year: r => r._y > 0,
    healthy: r => r._t === 0 && r._b > 0,
  };
  const shown = rows.filter(FOCUS[AGE_FOCUS] || FOCUS.all);

  // --- column definitions ---
  // Column definitions drive the header, the body, the sorting and the CSV — one source of truth. nocsv: on screen only.
  const defs = [];
  if (AGE_VIEW === 'parent') {
    defs.push({ k: 'parent', t: 'Parent ASIN', frz: 1 });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
    defs.push({ k: 'children', t: 'Children', num: 1 });
  } else {
    defs.push({ k: 'sku', t: 'SKU', frz: 1 });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
    defs.push({ k: 'asin', t: 'ASIN', mono: 1 }, { k: 'parent', t: 'Parent ASIN', mono: 1 });
  }
  defs.push({ k: 'product', t: 'Product' });
  // On screen the two figures that matter most sit next to the product, before the buckets; the CSV keeps its old
  // order (buckets, then these two — csvLast), so a sheet built on the export does not shift.
  defs.push({ k: 'available', t: 'Available', num: 1 });
  defs.push({ k: '_t', t: `Total aged ${AGED_FROM}+`, num: 1, bold: 1, csvLast: 1 });
  defs.push({ k: 'storage', t: 'Est. storage $', csvT: 'Est. Storage $', num: 1, money: 1, csvLast: 2 });
  defs.push({ k: '_p', t: 'Age mix', mix: 1, nocsv: 1 });
  cols.forEach(c => defs.push({ k: c, t: prettyAge(c), csvT: ageCsvTitle(c), num: 1, age: 1, aged: startOf(c) >= AGED_FROM,
    cls: ageBucketCls(c) }));

  // --- sort by the clicked column (numbers numerically, text alphabetically) ---
  const val = (r, d) => d.age ? (r.age[d.k] || 0) : (d.map ? d.map(r) : r[d.k]);
  const sd = defs.find(d => d.k === AGE_SORT.k) || defs.find(d => d.k === '_t');
  const cmp = (a, b) => {
    const x = val(a, sd), y = val(b, sd);
    const c = (typeof x === 'number' && typeof y === 'number')
      ? x - y
      : String(x || '').localeCompare(String(y || ''));
    return c * (sd.k === AGE_SORT.k ? AGE_SORT.dir : -1);
  };
  shown.sort(cmp);

  AGE_RENDER = { rows: shown, defs, val };                       // remembered for the CSV export

  // --- boxes and age mix ---
  $('ageResult').classList.remove('hide');
  renderAgeKpis(rows, brands, unit, cols);
  renderAgeMix(rows, brands, cols);

  // --- the table card's title and line ---
  const TITLES = {
    all: AGE_VIEW === 'parent' ? 'Every parent ASIN' : 'Every SKU',
    aged: `${AGE_VIEW === 'parent' ? 'Parents' : 'SKUs'} holding stock aged ${AGED_FROM}+ days`,
    year: `${AGE_VIEW === 'parent' ? 'Parents' : 'SKUs'} holding stock over a year old`,
    healthy: `${AGE_VIEW === 'parent' ? 'Parents' : 'SKUs'} with nothing past 180 days`,
  };
  $('ageTitle').textContent = TITLES[AGE_FOCUS] || TITLES.all;
  $('ageSub').textContent = `${ageNf(shown.length)} of ${ageNf(rows.length)} ${unit} · sorted by ${sd.t}`
    + `${(sd.k === AGE_SORT.k ? AGE_SORT.dir : -1) < 0 ? ', largest first' : ', smallest first'}`
    + (AGE_VIEW === 'parent' ? ' · click a parent to see its SKUs' : '');

  // --- build table: cell pieces ---
  const dash = '<span class="ag-dash">—</span>';
  const n = v => (v ? ageNf(v) : dash);
  const money = v => (v ? ageUsd(v) : dash);
  // Each aged column's largest figure on screen, so a chip's tint says how big it is next to the rest.
  const colMax = {};
  defs.filter(d => d.aged).forEach(d => { colMax[d.k] = Math.max(0, ...shown.map(r => r.age[d.k] || 0)); });
  const heat = (v, d) => {
    const f = colMax[d.k] ? v / colMax[d.k] : 0;
    return `<span class="ag-heat ${d.cls} ag-h${f > .66 ? 4 : f > .33 ? 3 : f > .1 ? 2 : 1}">${ageNf(v)}</span>`;
  };
  // The row's own age mix: one segment per bucket, as wide as its share of the row's units.
  const mini = r => {
    if (!r._b) return dash;
    const tip = cols.filter(c => r.age[c]).map(c => `${prettyAge(c)}: ${ageNf(r.age[c])} (${agePct(r.age[c], r._b)}%)`).join('\n');
    return `<div class="ag-mini" title="${ageEsc(tip)}">` + cols.filter(c => r.age[c])
      .map(c => `<i class="${ageBucketCls(c)}" style="flex:${r.age[c]}"></i>`).join('') + '</div>';
  };
  const tot = r => {
    if (!r._t) return dash;
    const p = Math.round(r._p * 100);
    const lvl = p >= 50 ? 'is-hi' : p >= 20 ? 'is-mid' : '';
    return `<span class="ag-tot"><b>${ageNf(r._t)}</b>${r.available ? `<small class="${lvl}">${p}% of available</small>` : ''}</span>`;
  };
  const chev = '<span class="ag-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></span>';

  // One cell. kid = a SKU row under an opened parent.
  const cell = (r, d, kid) => {
    const v = val(r, d);
    const num = d.num ? 'num' : '';
    const frz = d.frz ? 'frz ' : '';
    if (d.frz) {
      if (kid) return `<td class="frz"><span class="ag-id">${ageEsc(r.sku)}</span></td>`;
      const lead = AGE_VIEW === 'parent' ? chev : '';
      return `<td class="frz">${lead}<span class="ag-id">${ageEsc(v)}</span></td>`;
    }
    if (d.k === 'brand') return kid ? '<td></td>' : `<td><span class="ag-brand is-${r.brand}">${ageEsc(v)}</span></td>`;
    if (d.k === 'children') return kid ? '<td></td>' : `<td class="num"><span class="ag-kids">${ageNf(v)}</span></td>`;
    if (d.mono) return `<td>${v ? `<span class="ag-id">${ageEsc(v)}</span>` : dash}</td>`;
    if (d.k === 'product') {
      const sub = kid ? `<small>${ageEsc(r.asin || '')}</small>` : '';
      return `<td><span class="ag-prod" title="${ageEsc(v)}">${ageEsc(v) || dash}</span>${sub}</td>`;
    }
    if (d.mix) return `<td class="ag-mixc">${mini(r)}</td>`;
    if (d.age) return d.aged
      ? `<td class="${num}">${v ? heat(v, d) : dash}</td>`
      : `<td class="${num} ag-fresh">${n(v)}</td>`;
    if (d.k === '_t') return `<td class="${num}">${tot(r)}</td>`;
    if (d.money) return `<td class="${frz}${num}">${money(v)}</td>`;
    return `<td class="${frz}${num}">${n(v)}</td>`;
  };

  // --- build table: header (a group row over the age columns, then the titles) ---
  const firstAge = defs.findIndex(d => d.age);
  const nFresh = defs.filter(d => d.age && !d.aged).length, nAged = defs.filter(d => d.aged).length;
  const grp = firstAge < 0 ? '' : '<tr class="ag-grp">'
    + `<th colspan="${firstAge}"></th>`
    + (nFresh ? `<th colspan="${nFresh}" class="ag-g-ok"><span>Healthy · under ${AGED_FROM} days</span></th>` : '')
    + (nAged ? `<th colspan="${nAged}" class="ag-g-aged"><span>Aged · ${AGED_FROM}+ days</span></th>` : '')
    + (defs.length - firstAge - nFresh - nAged > 0 ? `<th colspan="${defs.length - firstAge - nFresh - nAged}"></th>` : '')
    + '</tr>';
  const sortDir = sd.k === AGE_SORT.k ? AGE_SORT.dir : -1;
  const head = '<thead>' + grp + '<tr>' + defs.map(d => {
    const on = d.k === sd.k;
    const arw = on ? `<span class="ag-arw">${sortDir < 0 ? '↓' : '↑'}</span>` : '';
    return `<th data-k="${ageEsc(d.k)}" class="${d.frz ? 'frz ' : ''}${d.num ? 'num ' : ''}${on ? 'is-sorted' : ''}"`
      + `>${ageEsc(d.t)}${arw}</th>`;
  }).join('') + '</tr></thead>';

  // --- build table: body (an opened parent is followed by its SKUs, largest aged first) ---
  const body = shown.map(r => {
    if (AGE_VIEW !== 'parent') return '<tr>' + defs.map(d => cell(r, d, false)).join('') + '</tr>';
    const open = AGE_OPEN.has(r.key);
    let h = `<tr class="ag-prow${open ? ' is-open' : ''}" data-key="${ageEsc(r.key)}" tabindex="0" aria-expanded="${open}">`
      + defs.map(d => cell(r, d, false)).join('') + '</tr>';
    if (open) {
      const kids = r.kids.map(k => stamp({ ...k })).sort((a, b) => b._t - a._t || b.available - a.available);
      h += kids.map(k => '<tr class="ag-kid">' + defs.map(d => cell(k, d, true)).join('') + '</tr>').join('');
    }
    return h;
  }).join('');

  // --- build table: TOTAL row ---
  const all = { age: {}, available: 0, storage: 0, children: 0 };
  shown.forEach(r => {
    all.available += r.available || 0;
    all.storage += r.storage || 0;
    all.children += r.children || 0;
    cols.forEach(c => { all.age[c] = (all.age[c] || 0) + (r.age[c] || 0); });
  });
  stamp(all);
  const foot = shown.length ? '<tfoot><tr>' + defs.map((d, i) => {
    if (i === 0) return '<td class="frz">TOTAL</td>';
    if (d.mix) return `<td class="ag-mixc">${mini(all)}</td>`;
    if (d.k === '_t') return `<td class="num">${tot(all)}</td>`;
    if (!d.num) return '<td></td>';
    const v = d.age ? all.age[d.k] : all[d.k];
    return `<td class="num">${d.money ? money(v) : n(v)}</td>`;
  }).join('') + '</tr></tfoot>' : '';

  const empty = `<tr><td colspan="${defs.length}" class="ag-empty"><b>Nothing to show</b>`
    + (q || AGE_FOCUS !== 'all'
      ? `No ${unit} match${q ? ` “${ageEsc(q)}”` : ''}${AGE_FOCUS !== 'all' ? ' in this focus — pick “All stock” above' : ''}.`
      : `No ${unit} in this snapshot.`) + '</td></tr>';
  $('ageTable').innerHTML = head + '<tbody>' + (body || empty) + '</tbody>' + foot;

  // --- events: click a header to sort by it (a second click flips it); click a parent row to open its SKUs ---
  $('ageTable').querySelectorAll('thead th[data-k]').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      AGE_SORT = { k, dir: AGE_SORT.k === k ? -AGE_SORT.dir : -1 };
      renderAge();
    };
  });
  $('ageTable').querySelectorAll('tr.ag-prow').forEach(tr => {
    const flip = () => {
      const k = tr.dataset.key;
      AGE_OPEN.has(k) ? AGE_OPEN.delete(k) : AGE_OPEN.add(k);
      renderAge();
    };
    tr.onclick = flip;
    tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  });
}

/**
 * Five number boxes, built from the SAME rows the table is drawn from (search included, focus not — so clicking a box
 * never moves the boxes). With both brands on screen each box says how the figure splits between them. A box is a button:
 * four of them set the focus, Est. storage sorts by storage.
 */
function renderAgeKpis(rows, brands, unit, cols) {
  const startOf = c => { const r = ageRange(c); return r ? r[0] : 0; };
  // --- add up one set of rows ---
  const tally = rs => rs.reduce((a, r) => {
    a.n++;
    a.avail += r.available || 0;
    a.aged += r._t || 0;
    a.year += r._y || 0;
    a.storage += r.storage || 0;
    a.units += r._b || 0;
    a.fresh += cols.filter(c => startOf(c) < AGED_FROM).reduce((s, c) => s + (r.age[c] || 0), 0);
    if (r._t > 0) a.agedRows++;
    if (r._y > 0) a.yearRows++;
    if (r._t === 0 && r._b > 0) a.okRows++;
    return a;
  }, { n: 0, avail: 0, aged: 0, year: 0, storage: 0, units: 0, fresh: 0, agedRows: 0, yearRows: 0, okRows: 0 });
  const t = tally(rows);
  const per = brands.map(b => ({ b, t: tally(rows.filter(r => r.brand === b)) }));
  // "Ridhi 15,941 · CPC 10,283" when both brands are on screen; otherwise the fallback line.
  const split = (f, fmt, fallback) => brands.length > 1
    ? per.map(p => `<b>${BRAND_NAME[p.b]}</b> ${fmt(f(p.t))}`).join(' · ')
    : fallback;

  const IC = {
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5v11"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15"/><path d="M5 19 13 11"/>',
  };
  const box = (o) => `<button type="button" class="ag-box ${o.cls}${o.on ? ' on' : ''}" ${o.attr}>
      <div class="ag-l"><span class="ag-ic"><svg viewBox="0 0 24 24">${IC[o.ic]}</svg></span>${o.label}</div>
      <div class="ag-v"><b>${o.v}</b>${o.chip ? `<span>${o.chip}</span>` : ''}</div>
      <div class="ag-note">${o.note}</div>
      <div class="ag-go">${o.go}</div>
    </button>`;

  const sortedByStorage = AGE_SORT.k === 'storage';
  $('ageKpis').innerHTML = [
    box({ cls: 'is-brand', ic: 'box', label: 'Available units', attr: 'data-f="all"', on: false,
      v: ageNf(t.avail), note: split(x => x.avail, ageNf, `${ageNf(t.n)} ${unit}`), go: `All ${ageNf(t.n)} ${unit} →` }),
    box({ cls: 'is-act', ic: 'clock', label: `Aged ${AGED_FROM}+ days`, attr: 'data-f="aged"', on: AGE_FOCUS === 'aged',
      v: ageNf(t.aged), chip: `${agePct(t.aged, t.avail)}% of available`,
      note: split(x => x.aged, ageNf, 'units past six months'), go: `${ageNf(t.agedRows)} ${unit} hold some →` }),
    box({ cls: 'is-bad', ic: 'alert', label: 'Over a year old', attr: 'data-f="year"', on: AGE_FOCUS === 'year',
      v: ageNf(t.year), chip: `${agePct(t.year, t.avail)}%`,
      note: split(x => x.year, ageNf, `units ${AGE_YEAR_FROM}+ days at Amazon`), go: `${ageNf(t.yearRows)} ${unit} hold some →` }),
    box({ cls: 'is-vio', ic: 'coin', label: 'Est. storage charge', attr: 'data-sort="storage"', on: sortedByStorage,
      v: t.storage ? ageUsd(t.storage) : '—', note: split(x => x.storage, v => ageUsd(v).replace(/\.\d\d$/, ''), 'from Amazon’s age report'),
      go: sortedByStorage ? 'Sorted by storage ✓' : 'Sort by storage →' }),
    box({ cls: 'is-ok', ic: 'leaf', label: `Healthy (under ${AGED_FROM} days)`, attr: 'data-f="healthy"', on: AGE_FOCUS === 'healthy',
      v: `${agePct(t.fresh, t.units)}%`, chip: `${ageNf(t.fresh)} units`,
      note: split(x => agePct(x.fresh, x.units), v => v + '%', 'of the units in Amazon’s age buckets'),
      go: `${ageNf(t.okRows)} ${unit} with nothing aged →` }),
  ].join('');

  // --- events: a box sets the focus (clicking the one already on goes back to all), or sorts by storage ---
  $('ageKpis').querySelectorAll('.ag-box').forEach(b => {
    b.onclick = () => {
      if (b.dataset.sort) AGE_SORT = { k: b.dataset.sort, dir: -1 };
      else AGE_FOCUS = (AGE_FOCUS === b.dataset.f && b.dataset.f !== 'all') ? 'all' : b.dataset.f;
      renderAge();
    };
  });
}

// The age mix card: one stacked bar per brand on screen (units per bucket, green → red), then a legend with each bucket's
// units and share across everything on screen. Built from the same rows as the boxes.
function renderAgeMix(rows, brands, cols) {
  const startOf = c => { const r = ageRange(c); return r ? r[0] : 0; };
  const sum = (rs, c) => rs.reduce((s, r) => s + (r.age[c] || 0), 0);
  const bar = (name, rs) => {
    const per = cols.map(c => ({ c, v: sum(rs, c) })), whole = per.reduce((s, x) => s + x.v, 0);
    const segs = per.filter(x => x.v).map(x =>
      `<i class="${ageBucketCls(x.c)}" style="flex:${x.v}" title="${ageEsc(`${name} · ${prettyAge(x.c)}: ${ageNf(x.v)} units (${agePct(x.v, whole)}%)`)}"></i>`
    ).join('');
    return `<div class="ag-mixrow"><span>${name}</span><div class="ag-stack">${segs}</div><em><b>${ageNf(whole)}</b> units</em></div>`;
  };
  const whole = cols.reduce((s, c) => s + sum(rows, c), 0);
  const legend = cols.map(c => {
    const v = sum(rows, c);
    return `<div class="ag-lg ${ageBucketCls(c)}${startOf(c) >= AGED_FROM ? ' is-aged' : ''}">`
      + `<small><i></i>${prettyAge(c)}</small><b>${ageNf(v)}<span>${agePct(v, whole)}%</span></b></div>`;
  }).join('');
  $('ageMix').classList.remove('hide');
  $('ageMix').innerHTML = `<div class="ag-mixhead"><b>Age mix</b>`
    + `<small>Units in each of Amazon’s age buckets — the further right, the closer to long-term storage fees</small></div>`
    + brands.map(b => bar(BRAND_NAME[b], rows.filter(r => r.brand === b))).join('')
    + `<div class="ag-legend">${legend}</div>`;
}

// The CSV keeps the column titles it always had ("91 To 180 Days"), so a sheet built on the export still lines up.
function ageCsvTitle(h) {
  return h.replace(/[-_]/g, ' ').replace(/^inv(entory)? age /i, '').replace(/\b\w/g, m => m.toUpperCase());
}
/** "inv-age-91-to-180-days" → "91–180 days", "inv-age-456-plus-days" → "456+ days" */
// Turn a raw age column header into the column title shown on screen (and in the CSV).
function prettyAge(h) {
  const r = ageRange(h);
  if (r) return r[1] === Infinity ? `${r[0]}+ days` : `${r[0]}–${r[1]} days`;
  return ageCsvTitle(h);
}

/** Download exactly what's on screen (current view, filter and sort) as a CSV Excel opens natively. */
// Export: build the CSV from the last rendered rows and columns (AGE_RENDER) and download it.
$('ageCsv').onclick = () => {
  if (!AGE_RENDER.rows.length) return;
  const { rows, val } = AGE_RENDER;
  // The Age mix bar is on screen only; Total aged and Est. storage go back to the end, where the CSV always had them.
  const shown = AGE_RENDER.defs.filter(d => !d.nocsv);
  const defs = [...shown.filter(d => !d.csvLast), ...shown.filter(d => d.csvLast).sort((a, b) => a.csvLast - b.csvLast)];
  // --- one CSV cell: quote it when it holds a comma, a quote or a line break ---
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // --- header line, then one line per row ---
  const lines = [defs.map(d => cell(d.csvT || d.t)).join(',')];   // csvT: the CSV's own, older column titles
  rows.forEach(r => lines.push(defs.map(d => cell(val(r, d))).join(',')));
  // --- download (the leading BOM makes Excel read it as UTF-8) ---
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inventory-age-${AGE_VIEW}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};
