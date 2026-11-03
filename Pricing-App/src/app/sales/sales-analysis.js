/* ================= SALES · SALES ANALYSIS: monthly sales by colour, article or SKU, back to the first order =================
 * Screens: Sales Analysis (ensureSa runs when the tab opens — core/nav.js).
 * Does: Rebuild from orders walks the brand's whole Orders workbook through the backend in chunks, adds up
 * every SKU's units and sales per month, joins the Catalog tab for colour, article and size, builds the
 * three views (by colour, by article, by SKU) ranked by the last two months' revenue, and saves the result
 * to Firestore (salesanalysis/{brand}, the SKU rows in sarows/{brand}_{n}) so later visits only read it
 * (saRebuild, loadSaCache). renderSa draws the chosen view as a month-by-month table, heat-mapped against
 * each row's own average; Export writes the view as CSV.
 * Main functions: ensureSa, loadSaCache, saRebuild, renderSa, saMsg; the handlers of the pickers, the filter
 * box, Rebuild from orders and Export. */

/* ================= SALES ANALYSIS =================
 *
 * Monthly sales by COLOUR, by ARTICLE or by SKU, back to the start of the order history — built
 * here, from this account's own Orders workbook and its Catalog tab. Nothing is read from any other
 * project; Amazon Hub's version was only ever the shape to copy.
 *
 * BUILT ON A BUTTON, THEN CACHED. The workbooks hold 174,000 and 193,000 rows and a single pass over
 * one has already been measured at 92 seconds before it started failing outright — so the backend
 * hands them over in chunks and this walks them, then stores the finished matrix in Firestore. A
 * month of orders does not change while you are looking at it; re-reading 190,000 rows on every
 * visit would be pure waiting.
 *
 * The three exclusions are the backend's, so these totals and the Sales Dashboard's cannot disagree:
 * MCF orders, cancelled rows and other marketplaces are all left out.
 */
const SA_CHUNK = 250;   // SKU rows per sarows document
// The screen's state: the brand, view and metric picked, the built matrix (null until read or built), a busy
// flag and the last error.
let SA = { brand: 'SP', view: 'color', metric: 'pct', data: null, loading: false, err: '' };
const SA_MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The message line under the controls (HTML allowed): grey normally, red when bad is true; blank clears it.
function saMsg(text, bad) {
  const msg = $('saMsg');
  msg.innerHTML = text || '';
  msg.className = bad ? 'err' : 'muted';
}

// Opening the tab: read the saved matrix for the brand if it is not here yet, then draw.
async function ensureSa() {
  if (!SA.data) await loadSaCache();
  renderSa();
}

// Read the brand's saved matrix: the summary document, then its SKU rows chunk by chunk. SA.data stays null
// when nothing has been built yet (or the read failed — SA.err says why).
async function loadSaCache() {
  SA.err = '';
  try {
    const meta = await getDoc(doc(db, 'salesanalysis', SA.brand));
    if (!meta.exists()) {
      SA.data = null;
      return;
    }
    const data = meta.data();
    let sku = [];
    for (let i = 0; i < (data.skuChunks || 0); i++) {
      const chunk = await getDoc(doc(db, 'sarows', `${SA.brand}_${i}`));
      if (chunk.exists()) sku = sku.concat(chunk.data().r || []);
    }
    SA.data = {
      months: data.months || [], labels: data.labels || [], at: data.at || '',
      color: data.color || [], article: data.article || [], sku,
    };
  } catch (e) {
    SA.err = e.message || String(e);
    SA.data = null;
  }
}

/**
 * Walk the whole Orders workbook, then work the report out here.
 *
 * The aggregation is done in the browser rather than the backend because Apps Script forgets
 * everything between requests — carrying a part-built matrix across twenty round trips would mean
 * storing it somewhere anyway. Here it is just a variable.
 */
async function saRebuild() {
  const btn = $('saRebuild');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  SA.loading = true;
  SA.err = '';
  try {
    // --- 1. walk the Orders workbook in chunks: units and sales per SKU per month ---
    const book = SA.brand === 'CPC' ? 1 : 0;
    const perSku = {};                       // sku → { 'YYYY-MM': [qty, amt] }
    let start = 2, guard = 0, lastRow = 0;   // the next row to read, the loop guard, the workbook's last row
    while (start && guard++ < 60) {          // a guard, not a limit: 60 × 20,000 is 1.2m rows
      const reply = await baCall({ sales: 'chunk', book, start, rows: 20000 });
      if (!reply.ok) throw new Error(reply.error || 'The orders workbook could not be read.');
      lastRow = reply.lastRow || lastRow;
      Object.entries(reply.d || {}).forEach(([sku, months]) => {
        const skuMonths = perSku[sku] || (perSku[sku] = {});
        Object.entries(months).forEach(([month, figures]) => {
          const pair = skuMonths[month] || (skuMonths[month] = [0, 0]);
          pair[0] += figures[0] || 0;
          pair[1] += figures[1] || 0;
        });
      });
      saMsg(`Reading the orders workbook… ${Math.min(start + 20000, lastRow).toLocaleString('en-US')}`
        + ` of ${lastRow.toLocaleString('en-US')} rows`);
      start = reply.next;
    }

    // --- 2. the catalogue: colour, article (sub-category), size and ASIN per SKU ---
    saMsg('Reading the catalogue…');
    const cat = await baCall({ sales: 'cat', brand: SA.brand });
    if (!cat.ok) throw new Error(cat.error || 'The Catalog tab could not be read.');
    const CAT = cat.map || {};

    // --- 3. the months, their labels, and each month's grand total ---
    // Months, newest first — the order the report is read in.
    const months = [...new Set(Object.values(perSku).flatMap(skuMonths => Object.keys(skuMonths)))].sort().reverse();
    const labels = months.map(month => `${SA_MON[Number(month.slice(5, 7))]} '${month.slice(2, 4)}`);

    // Every month's total units, which is what "% share" is a share OF.
    const grand = {};
    months.forEach(month => {
      grand[month] = 0;
    });
    Object.values(perSku).forEach(skuMonths => months.forEach(month => {
      if (skuMonths[month]) grand[month] += skuMonths[month][0];
    }));

    // --- 4. the three views: one row per SKU, per colour, per article ---
    // one cell per month, newest first: { qty, amt, pct of that month's units }
    const cells = get => months.map(month => {
      const figures = get(month) || [0, 0];
      return { qty: Math.round(figures[0]), amt: Math.round(figures[1]), pct: grand[month] ? figures[0] / grand[month] : 0 };
    });
    // Ranked by the revenue of the LAST TWO months, so the order moves with the business instead of
    // being frozen on whatever sold best two years ago. months[0] is the current month.
    const rank = series => (series[0] ? series[0].amt : 0) + (series[1] ? series[1].amt : 0);

    const skuRows = Object.keys(perSku).map(sku => {
      const info = CAT[sku] || {};
      const m = cells(month => perSku[sku][month]);
      return { name: sku, asin: info.asin || '', subcat: info.subcat || '', color: info.color || '',
        size: info.size || '', m, _r: rank(m) };
    }).sort((a, b) => b._r - a._r);

    // the SKUs grouped by one catalogue field (colour or article), each group's months added up
    const aggBy = pick => {
      const agg = {};
      Object.keys(perSku).forEach(sku => {
        // A SKU the Catalog tab has never heard of is NOT dropped — its sales are real. It lands in
        // "(unknown)", where a growing number is itself the signal that the catalogue needs a row.
        const key = String(pick(CAT[sku] || {}) || '').trim() || '(unknown)';
        const group = agg[key] || (agg[key] = { skus: new Set(), mm: {} });
        group.skus.add(sku);
        Object.entries(perSku[sku]).forEach(([month, figures]) => {
          const pair = group.mm[month] || (group.mm[month] = [0, 0]);
          pair[0] += figures[0];
          pair[1] += figures[1];
        });
      });
      return Object.entries(agg).map(([name, group]) => {
        const m = cells(month => group.mm[month]);
        return { name, skus: group.skus.size, m, _r: rank(m) };
      }).sort((x, y) => y._r - x._r);
    };
    const color = aggBy(info => info.color);
    const article = aggBy(info => info.subcat);
    [skuRows, color, article].forEach(list => list.forEach(row => {
      delete row._r;
    }));

    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    SA.data = { months, labels, at, color, article, sku: skuRows };

    // --- 5. save it, then draw ---
    saMsg('Saving…');
    const chunks = Math.ceil(skuRows.length / SA_CHUNK) || 1;
    for (let i = 0; i < chunks; i++) {
      await setDoc(doc(db, 'sarows', `${SA.brand}_${i}`),
        { r: skuRows.slice(i * SA_CHUNK, (i + 1) * SA_CHUNK) });
    }
    await setDoc(doc(db, 'salesanalysis', SA.brand), {
      months, labels, at, color, article, skuChunks: chunks,
      rows: lastRow, by: ME.email, saved: serverTimestamp(),
    });
    renderSa();
  } catch (e) {
    SA.err = e.message || String(e);
    saMsg('Could not build it: ' + SA.err, true);
  }
  SA.loading = false;
  btn.disabled = false;
  btn.textContent = 'Rebuild from orders';
}

// Draw the chosen view: one row per colour, article or SKU, one column per month, each cell heat-mapped
// against the row's own average (not for money). The first 400 rows only; Export covers them all.
function renderSa() {
  // --- formatters ---
  const esc = str => String(str == null ? '' : str)
    .replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const nf = value => Math.round(Number(value) || 0).toLocaleString('en-US');
  // --- nothing to draw yet ---
  if (SA.err && !SA.data) {
    $('saTable').innerHTML = '<tbody><tr><td class="ui-empty">Nothing to show.'
      + '</td></tr></tbody>';
    return;
  }
  if (!SA.data) {
    saMsg('');
    $('saTable').innerHTML = '<tbody><tr><td class="ui-empty">'
      + 'Nothing built for this brand yet. Press <b>Rebuild from orders</b> — it reads the whole Orders '
      + 'workbook once (a minute or so) and remembers the result.</td></tr></tbody>';
    return;
  }

  // --- the rows of the view, filtered by the search box ---
  const data = SA.data;
  const metric = SA.metric;
  const rowsAll = data[SA.view] || [];
  const search = $('saFilter').value.trim().toLowerCase();
  const rows = rowsAll.filter(row => !search || String(row.name || '').toLowerCase().includes(search)
    || (SA.view === 'sku' && (`${row.subcat} ${row.color} ${row.size}`).toLowerCase().includes(search)));

  // --- the columns: the identifying ones first, then one per month ---
  const idCols = SA.view === 'sku'
    ? [['name', 'SKU'], ['subcat', 'Sub-Category'], ['color', 'Color'], ['size', 'Size']]
    : [['name', SA.view === 'color' ? 'Color' : 'Article'], ['skus', 'SKUs']];

  // a cell's value and its text, for the metric picked
  const valOf = cell => metric === 'amt' ? (cell.amt || 0) : metric === 'pct' ? (cell.pct || 0) : (cell.qty || 0);
  const fmt = cell => metric === 'amt' ? '$' + nf(cell.amt)
    : metric === 'pct' ? ((cell.pct || 0) * 100).toFixed(1) + '%' : nf(cell.qty);
  // A floor, so a row selling three a month is not painted red for selling four. The heatmap answers
  // "when was THIS row's own peak", and on tiny numbers that question is noise.
  const floor = metric === 'pct' ? 0.03 : 1;

  // --- head and body ---
  const head = '<thead><tr>'
    + idCols.map((col, i) => `<th${i === 0 ? ' class="frz"' : ''}>${esc(col[1])}</th>`).join('')
    + data.labels.map(label => `<th class="num">${esc(label)}</th>`).join('') + '</tr></thead>';

  const body = rows.slice(0, 400).map(row => {
    const cells = row.m || [];
    const vals = cells.map(valOf);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const peak = vals.reduce((a, b) => Math.max(a, b), 0);
    const ids = idCols.map(([key], i) => `<td${i === 0 ? ' class="frz"' : ''}${SA.view === 'sku' && key === 'name'
      ? '' : ''}>${esc(row[key] == null ? '' : row[key])}</td>`).join('');
    const monthCells = cells.map(cell => {
      const value = valOf(cell);
      let cls = '';
      // Money is deliberately not heat-mapped: a row's own average means little against a price
      // that changed over the period.
      if (metric !== 'amt' && mean > 0 && value >= floor) {
        const ratio = value / mean;
        if (ratio >= 2.5 || (value === peak && ratio >= 1.6)) cls = ' sa-hot';
        else if (ratio >= 1.8) cls = ' sa-warm';
        else if (ratio >= 1.3) cls = ' sa-mild';
      }
      return `<td class="num${cls}">${fmt(cell)}</td>`;
    }).join('');
    return `<tr>${ids}${monthCells}</tr>`;
  }).join('');

  $('saTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="9" class="ui-empty">Nothing matches that search.</td></tr>')
    + '</tbody>';
  // --- the message line ---
  saMsg(`${nf(rows.length)} row(s)${rows.length > 400 ? ' · showing the first 400 · Export covers all of them' : ''}`
    + ` · ${data.months.length} month(s) · built ${esc(data.at)}`
    + ' · MCF, cancelled orders and other marketplaces are excluded.');
}

// The pickers: a new brand reads that brand's saved matrix first; view and metric just redraw.
['saBrand', 'saView', 'saMetric'].forEach(id => $(id).addEventListener('change', async () => {
  const brand = $('saBrand').value;
  SA.view = $('saView').value;
  SA.metric = $('saMetric').value;
  if (brand !== SA.brand) {
    SA.brand = brand;
    SA.data = null;
    await loadSaCache();
  }
  renderSa();
}));
// The search box waits a quarter of a second after the last keystroke.
let SA_FILTER_T = null;
$('saFilter').addEventListener('input', () => {
  clearTimeout(SA_FILTER_T);
  SA_FILTER_T = setTimeout(renderSa, 250);
});
$('saRebuild').onclick = saRebuild;

// Export: the view on screen (every row that matches the search, not just 400) as CSV, one column per month.
$('saExport').onclick = () => {
  if (!SA.data) return;
  const data = SA.data;
  const metric = SA.metric;
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const valOf = figures => metric === 'amt' ? (figures.amt || 0)
    : metric === 'pct' ? Number(((figures.pct || 0) * 100).toFixed(2)) : (figures.qty || 0);
  const search = $('saFilter').value.trim().toLowerCase();
  const rows = (data[SA.view] || []).filter(row => !search || String(row.name || '').toLowerCase().includes(search)
    || (SA.view === 'sku' && String(row.subcat || '').toLowerCase().includes(search)));
  const idHdr = SA.view === 'sku' ? ['SKU', 'Sub-Category', 'Color', 'Size']
    : [SA.view === 'color' ? 'Color' : 'Article', 'SKUs'];
  const lines = [idHdr.concat(data.labels).map(cell).join(',')];
  rows.forEach(row => {
    const idv = SA.view === 'sku' ? [row.name, row.subcat, row.color, row.size] : [row.name, row.skus];
    lines.push(idv.concat((row.m || []).map(valOf)).map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `sales-${SA.view}-${SA.brand}-${SA.metric}-${dToday()}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

