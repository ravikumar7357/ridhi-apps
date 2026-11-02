/* ================= INVENTORY · INVENTORY AGE: how old the FBA stock is, per parent or per SKU =================
 * Screens: Inventory Age (tab 'age'; core/nav.js calls ensureAge when it opens). The toolbar has the Parent ASINs /
 * Child ASINs view buttons (ageViewParent, ageViewChild), the brand picker (ageBrandView: Ridhi, CPC or both), the
 * filter box (ageFilter), Export (ageCsv) and Refresh both brands (ageGo); ageMsg is its message line. Below it:
 * one KPI card per brand (ageKpis) and the table (ageTable).
 * Does: keeps the last ageing snapshot per brand in Firestore (age/SP, age/CPC) so the tab opens already populated
 * (loadAgeCache, saveAgeCache). Refresh asks the backend (baCall, in sales/brand-analytics.js) to create Amazon's
 * FBA inventory age report for each brand, polls until it is ready, caches it and redraws. The report's overlapping
 * day buckets are reduced to the non-overlapping set (ageRange, totalCols); only buckets starting at AGED_FROM days
 * count as "aged". renderAge draws the table in the chosen view (children rolled up per parent, shown with the
 * hand-corrected parent names from Listing audit — PNAME, AUDIT_MANUAL — or one row per SKU), applies the filter
 * and the clicked sort, and renderAgeKpis builds the cards from the same rows; Export downloads exactly what is on
 * screen as a CSV.
 * Main functions: ageMsg, ageRange, totalCols, loadAgeCache, saveAgeCache, ensureAge, renderAge, renderAgeKpis,
 * prettyAge, and the Refresh both brands (ageGo) and Export (ageCsv) handlers. */

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
  $('ageGo').innerHTML = '<span class="spin"></span>…';
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

// Draw the whole screen from AGE: the KPI cards and the table for the chosen brands, view, filter and sort.
function renderAge() {
  // --- view buttons ---
  $('ageViewParent').classList.toggle('on', AGE_VIEW === 'parent');
  $('ageViewChild').classList.toggle('on', AGE_VIEW === 'child');

  // --- which brands; the empty state when nothing is cached yet ---
  const pick = $('ageBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => AGE[b]);
  if (!brands.length) {
    $('ageResult').classList.remove('hide');
    $('ageKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshot yet</div>'
      + '<div class="muted" style="margin-top:6px">Hit “Refresh both brands” to pull the ageing report from Amazon.'
      + '</div></div>';
    $('ageTable').innerHTML = '';
    return;
  }

  // --- the age columns and the "aged" total ---
  // Only the non-overlapping buckets are shown AND totalled — the redundant narrow ones are dropped.
  const allCols = [...new Set(brands.flatMap(b => AGE[b].cols))];
  const cols = totalCols(allCols);
  const agedCols = cols.filter(c => { const r = ageRange(c); return r && r[0] >= AGED_FROM; });
  const totalOf = r => agedCols.reduce((s, c) => s + (r.age[c] || 0), 0);
  const multiBrand = brands.length > 1;

  // --- rows: one per SKU, each tagged with its brand ---
  let rows = brands.flatMap(b => AGE[b].rows.map(r => ({ ...r, brand: b })));

  if (AGE_VIEW === 'parent') {                                   // roll children up into their parent
    const g = {};
    rows.forEach(r => {
      const key = (r.parent || r.asin || r.sku) + '|' + r.brand;
      const o = g[key] || (g[key] = {
        parent: r.parent || r.asin || '—',
        brand: r.brand,
        product: r.product,
        children: 0,
        available: 0,
        storage: 0,
        age: {}
      });
      o.children++;
      o.available += r.available || 0;
      o.storage += r.storage || 0;
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

  // --- filter, then the aged total per row ---
  const q = $('ageFilter').value.trim().toLowerCase();
  if (q) rows = rows.filter(r => ((r.sku || '') + ' ' + (r.asin || '') + ' ' + (r.parent || '') + ' '
    + (r.product || '')).toLowerCase().includes(q));
  rows.forEach(r => { r._t = totalOf(r); });

  // --- column definitions ---
  // Column definitions drive the header, the body, the sorting and the CSV — one source of truth.
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
  defs.push({ k: 'product', t: 'Product', trunc: 38 });
  defs.push({ k: 'available', t: 'Available', num: 1 });
  cols.forEach(c => defs.push({ k: c, t: prettyAge(c), num: 1, age: 1 }));
  defs.push({ k: '_t', t: `Total aged ${AGED_FROM}+`, num: 1, bold: 1 });
  defs.push({ k: 'storage', t: 'Est. Storage $', num: 1, money: 1 });

  // --- sort by the clicked column (numbers numerically, text alphabetically) ---
  const val = (r, d) => d.age ? (r.age[d.k] || 0) : (d.map ? d.map(r) : r[d.k]);
  const sd = defs.find(d => d.k === AGE_SORT.k) || defs.find(d => d.k === '_t');
  rows.sort((a, b) => {
    const x = val(a, sd), y = val(b, sd);
    const c = (typeof x === 'number' && typeof y === 'number')
      ? x - y
      : String(x || '').localeCompare(String(y || ''));
    return c * AGE_SORT.dir;
  });

  AGE_RENDER = { rows, defs, val };                              // remembered for the CSV export

  // --- KPI cards ---
  const aged = rows.reduce((s, r) => s + r._t, 0);
  const avail = rows.reduce((s, r) => s + (r.available || 0), 0);
  $('ageResult').classList.remove('hide');
  renderAgeKpis(rows, brands, AGE_VIEW === 'parent' ? 'parents' : 'SKUs');

  // --- build table: cell formatters ---
  const n = v => (v ? Number(v).toLocaleString('en-US') : '<span class="muted">—</span>');
  const money = v => (v ? '$' + Number(v).toFixed(2) : '<span class="muted">—</span>');
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const arrow = d => d.k === AGE_SORT.k ? (AGE_SORT.dir < 0 ? ' ↓' : ' ↑') : '';

  // --- build table: header ---
  const head = '<thead><tr>' + defs.map(d =>
    `<th data-k="${esc(d.k)}" class="${d.frz ? 'frz ' : ''}${d.num ? 'num' : ''}">${esc(d.t)}${arrow(d)}</th>`
  ).join('') + '</tr></thead>';

  // --- build table: body ---
  const body = rows.map(r => '<tr>' + defs.map(d => {
    const v = val(r, d);
    const cls = (d.frz ? 'frz ' : '') + (d.num ? 'num' : '');
    const style = (d.mono ? 'font-family:ui-monospace,monospace' : '') + (d.bold ? ';font-weight:700' : '');
    if (d.money) return `<td class="${cls}">${money(v)}</td>`;
    if (d.num) return `<td class="${cls}">${n(v)}</td>`;
    if (d.trunc) return `<td class="${cls}" title="${esc(v)}">${esc(String(v || '').slice(0, d.trunc))}</td>`;
    return `<td class="${cls}" style="${style}">${esc(v) || '<span class="muted">—</span>'}</td>`;
  }).join('') + '</tr>').join('');

  // --- build table: TOTAL row ---
  const foot = rows.length ? '<tfoot><tr>' + defs.map((d, i) => {
    if (i === 0) return `<td class="frz">TOTAL</td>`;
    if (!d.num) return '<td></td>';
    const sum = rows.reduce((s, r) => s + (Number(val(r, d)) || 0), 0);
    return `<td class="num">${d.money ? money(sum) : n(sum)}</td>`;
  }).join('') + '</tr></tfoot>' : '';

  $('ageTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No rows.</td></tr>`) + '</tbody>' + foot;

  // --- events: click a header to sort by it; a second click flips the direction ---
  $('ageTable').querySelectorAll('thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      AGE_SORT = { k, dir: AGE_SORT.k === k ? -AGE_SORT.dir : -1 };
      renderAge();
    };
  });
}

/**
 * One KPI card per brand (plus a combined one when both are shown). Built from the SAME rows the
 * table is showing, so the cards always agree with what's on screen — filter included.
 */
// Draw the KPI cards into ageKpis: per brand, the aged units (and % of available), storage charge,
// available units and the row count (unit = 'parents' or 'SKUs').
function renderAgeKpis(rows, brands, unit) {
  // --- formatters ---
  const nf = v => Number(v || 0).toLocaleString('en-US');
  const usd = v => '$' + Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dash = '<span class="muted">—</span>';

  // --- add up one set of rows ---
  const tally = rs => rs.reduce((a, r) => {
    a.n++;
    a.avail += r.available || 0;
    a.aged += r._t || 0;
    a.storage += r.storage || 0;
    return a;
  }, { n: 0, avail: 0, aged: 0, storage: 0 });

  // --- one card ---
  const card = (name, t, when) => {
    const pctAged = t.avail ? Math.round((t.aged / t.avail) * 100) : 0;
    return `<div class="kpi">
      <div class="kpihead">
        <span class="kpiname">${name}</span>
        <span class="kpiwhen">${when || ''}</span>
      </div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(t.aged)}</div><div class="l">Aged ${AGED_FROM}+ units${t.avail ? ` · ${pctAged}%` : ''}</div></div>
        <div class="metric"><div class="v">${t.storage ? usd(t.storage) : dash}</div><div class="l">Est. storage charge</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${nf(t.avail)}</div><div class="l">Available</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${nf(t.n)}</div><div class="l">${unit}</div></div>
      </div>
    </div>`;
  };

  // --- one card per brand on screen ---
  $('ageKpis').innerHTML = brands.map(b => {
    const when = AGE[b] && AGE[b].at ? 'updated ' + AGE[b].at.toLocaleString() : '';
    return card(BRAND_NAME[b], tally(rows.filter(r => r.brand === b)), when);
  }).join('');
}

/** "inv-age-91-to-180-days" → "91 To 180 Days" */
// Turn a raw age column header into the column title shown on screen.
function prettyAge(h) {
  return h.replace(/[-_]/g, ' ').replace(/^inv(entory)? age /i, '').replace(/\b\w/g, m => m.toUpperCase());
}

/** Download exactly what's on screen (current view, filter and sort) as a CSV Excel opens natively. */
// Export: build the CSV from the last rendered rows and columns (AGE_RENDER) and download it.
$('ageCsv').onclick = () => {
  if (!AGE_RENDER.rows.length) return;
  const { rows, defs, val } = AGE_RENDER;
  // --- one CSV cell: quote it when it holds a comma, a quote or a line break ---
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // --- header line, then one line per row ---
  const lines = [defs.map(d => cell(d.t)).join(',')];
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
