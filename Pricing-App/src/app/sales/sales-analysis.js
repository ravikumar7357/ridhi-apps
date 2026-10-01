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
const SA_CHUNK = 250;
let SA = { brand: 'SP', view: 'color', metric: 'pct', data: null, loading: false, err: '' };
const SA_MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function saMsg(t, bad) { const m = $('saMsg'); m.innerHTML = t || ''; m.className = bad ? 'err' : 'muted'; }

async function ensureSa() {
  if (!SA.data) await loadSaCache();
  renderSa();
}

async function loadSaCache() {
  SA.err = '';
  try {
    const meta = await getDoc(doc(db, 'salesanalysis', SA.brand));
    if (!meta.exists()) { SA.data = null; return; }
    const d = meta.data();
    let sku = [];
    for (let i = 0; i < (d.skuChunks || 0); i++) {
      const c = await getDoc(doc(db, 'sarows', `${SA.brand}_${i}`));
      if (c.exists()) sku = sku.concat(c.data().r || []);
    }
    SA.data = { months: d.months || [], labels: d.labels || [], at: d.at || '',
      color: d.color || [], article: d.article || [], sku };
  } catch (e) { SA.err = e.message || String(e); SA.data = null; }
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
  btn.disabled = true; btn.textContent = 'Reading…';
  SA.loading = true; SA.err = '';
  try {
    const book = SA.brand === 'CPC' ? 1 : 0;
    const perSku = {};                       // sku → { 'YYYY-MM': [qty, amt] }
    let start = 2, guard = 0, lastRow = 0;
    while (start && guard++ < 60) {          // a guard, not a limit: 60 × 20,000 is 1.2m rows
      const r = await baCall({ sales: 'chunk', book, start, rows: 20000 });
      if (!r.ok) throw new Error(r.error || 'The orders workbook could not be read.');
      lastRow = r.lastRow || lastRow;
      Object.entries(r.d || {}).forEach(([sku, months]) => {
        const m = perSku[sku] || (perSku[sku] = {});
        Object.entries(months).forEach(([k, v]) => {
          const b = m[k] || (m[k] = [0, 0]);
          b[0] += v[0] || 0; b[1] += v[1] || 0;
        });
      });
      saMsg(`Reading the orders workbook… ${Math.min(start + 20000, lastRow).toLocaleString('en-US')}`
        + ` of ${lastRow.toLocaleString('en-US')} rows`);
      start = r.next;
    }

    saMsg('Reading the catalogue…');
    const cat = await baCall({ sales: 'cat', brand: SA.brand });
    if (!cat.ok) throw new Error(cat.error || 'The Catalog tab could not be read.');
    const CAT = cat.map || {};

    // Months, newest first — the order the report is read in.
    const months = [...new Set(Object.values(perSku).flatMap(m => Object.keys(m)))].sort().reverse();
    const labels = months.map(m => `${SA_MON[Number(m.slice(5, 7))]} '${m.slice(2, 4)}`);

    // Every month's total units, which is what "% share" is a share OF.
    const grand = {};
    months.forEach(m => { grand[m] = 0; });
    Object.values(perSku).forEach(mm => months.forEach(m => { if (mm[m]) grand[m] += mm[m][0]; }));

    const cells = get => months.map(m => {
      const v = get(m) || [0, 0];
      return { qty: Math.round(v[0]), amt: Math.round(v[1]), pct: grand[m] ? v[0] / grand[m] : 0 };
    });
    // Ranked by the revenue of the LAST TWO months, so the order moves with the business instead of
    // being frozen on whatever sold best two years ago. months[0] is the current month.
    const rank = ms => (ms[0] ? ms[0].amt : 0) + (ms[1] ? ms[1].amt : 0);

    const skuRows = Object.keys(perSku).map(sku => {
      const c = CAT[sku] || {};
      const m = cells(k => perSku[sku][k]);
      return { name: sku, asin: c.asin || '', subcat: c.subcat || '', color: c.color || '',
        size: c.size || '', m, _r: rank(m) };
    }).sort((a, b) => b._r - a._r);

    const aggBy = pick => {
      const agg = {};
      Object.keys(perSku).forEach(sku => {
        // A SKU the Catalog tab has never heard of is NOT dropped — its sales are real. It lands in
        // "(unknown)", where a growing number is itself the signal that the catalogue needs a row.
        const key = String(pick(CAT[sku] || {}) || '').trim() || '(unknown)';
        const a = agg[key] || (agg[key] = { skus: new Set(), mm: {} });
        a.skus.add(sku);
        Object.entries(perSku[sku]).forEach(([k, v]) => {
          const b = a.mm[k] || (a.mm[k] = [0, 0]);
          b[0] += v[0]; b[1] += v[1];
        });
      });
      return Object.entries(agg).map(([name, a]) => {
        const m = cells(k => a.mm[k]);
        return { name, skus: a.skus.size, m, _r: rank(m) };
      }).sort((x, y) => y._r - x._r);
    };
    const color = aggBy(c => c.color), article = aggBy(c => c.subcat);
    [skuRows, color, article].forEach(rs => rs.forEach(r => { delete r._r; }));

    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    SA.data = { months, labels, at, color, article, sku: skuRows };

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
  btn.disabled = false; btn.textContent = 'Rebuild from orders';
}

function renderSa() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const nf = v => Math.round(Number(v) || 0).toLocaleString('en-US');
  if (SA.err && !SA.data) {
    $('saTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">Nothing to show.</td></tr></tbody>';
    return;
  }
  if (!SA.data) {
    saMsg('');
    $('saTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + 'Nothing built for this brand yet. Press <b>Rebuild from orders</b> — it reads the whole Orders '
      + 'workbook once (a minute or so) and remembers the result.</td></tr></tbody>';
    return;
  }

  const D = SA.data, metric = SA.metric;
  const rowsAll = D[SA.view] || [];
  const q = $('saFilter').value.trim().toLowerCase();
  const rows = rowsAll.filter(r => !q || String(r.name || '').toLowerCase().includes(q)
    || (SA.view === 'sku' && (`${r.subcat} ${r.color} ${r.size}`).toLowerCase().includes(q)));

  const idCols = SA.view === 'sku'
    ? [['name', 'SKU'], ['subcat', 'Sub-Category'], ['color', 'Color'], ['size', 'Size']]
    : [['name', SA.view === 'color' ? 'Color' : 'Article'], ['skus', 'SKUs']];

  const valOf = c => metric === 'amt' ? (c.amt || 0) : metric === 'pct' ? (c.pct || 0) : (c.qty || 0);
  const fmt = c => metric === 'amt' ? '$' + nf(c.amt)
    : metric === 'pct' ? ((c.pct || 0) * 100).toFixed(1) + '%' : nf(c.qty);
  // A floor, so a row selling three a month is not painted red for selling four. The heatmap answers
  // "when was THIS row's own peak", and on tiny numbers that question is noise.
  const floor = metric === 'pct' ? 0.03 : 1;

  const head = '<thead><tr>'
    + idCols.map((c, i) => `<th${i === 0 ? ' class="frz"' : ''}>${esc(c[1])}</th>`).join('')
    + D.labels.map(m => `<th class="num">${esc(m)}</th>`).join('') + '</tr></thead>';

  const body = rows.slice(0, 400).map(r => {
    const cs = r.m || [];
    const vals = cs.map(valOf);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const mx = vals.reduce((a, b) => Math.max(a, b), 0);
    const ids = idCols.map(([k], i) => `<td${i === 0 ? ' class="frz"' : ''}${SA.view === 'sku' && k === 'name'
      ? ' style="font-family:ui-monospace,monospace"' : ''}>${esc(r[k] == null ? '' : r[k])}</td>`).join('');
    const ms = cs.map(c => {
      const v = valOf(c);
      let cls = '';
      // Money is deliberately not heat-mapped: a row's own average means little against a price
      // that changed over the period.
      if (metric !== 'amt' && mean > 0 && v >= floor) {
        const ratio = v / mean;
        if (ratio >= 2.5 || (v === mx && ratio >= 1.6)) cls = ' sa-hot';
        else if (ratio >= 1.8) cls = ' sa-warm';
        else if (ratio >= 1.3) cls = ' sa-mild';
      }
      return `<td class="num${cls}">${fmt(c)}</td>`;
    }).join('');
    return `<tr>${ids}${ms}</tr>`;
  }).join('');

  $('saTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="9" class="muted" style="padding:14px">Nothing matches that search.</td></tr>') + '</tbody>';
  saMsg(`${nf(rows.length)} row(s)${rows.length > 400 ? ' · showing the first 400 · Export covers all of them' : ''}`
    + ` · ${D.months.length} month(s) · built ${esc(D.at)}`
    + ' · MCF, cancelled orders and other marketplaces are excluded.');
}

['saBrand', 'saView', 'saMetric'].forEach(id => $(id).addEventListener('change', async () => {
  const brand = $('saBrand').value;
  SA.view = $('saView').value; SA.metric = $('saMetric').value;
  if (brand !== SA.brand) { SA.brand = brand; SA.data = null; await loadSaCache(); }
  renderSa();
}));
let SA_FILTER_T = null;
$('saFilter').addEventListener('input', () => { clearTimeout(SA_FILTER_T); SA_FILTER_T = setTimeout(renderSa, 250); });
$('saRebuild').onclick = saRebuild;

$('saExport').onclick = () => {
  if (!SA.data) return;
  const D = SA.data, metric = SA.metric;
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const valOf = c => metric === 'amt' ? (c.amt || 0)
    : metric === 'pct' ? Number(((c.pct || 0) * 100).toFixed(2)) : (c.qty || 0);
  const q = $('saFilter').value.trim().toLowerCase();
  const rows = (D[SA.view] || []).filter(r => !q || String(r.name || '').toLowerCase().includes(q)
    || (SA.view === 'sku' && String(r.subcat || '').toLowerCase().includes(q)));
  const idHdr = SA.view === 'sku' ? ['SKU', 'Sub-Category', 'Color', 'Size']
    : [SA.view === 'color' ? 'Color' : 'Article', 'SKUs'];
  const lines = [idHdr.concat(D.labels).map(cell).join(',')];
  rows.forEach(r => {
    const idv = SA.view === 'sku' ? [r.name, r.subcat, r.color, r.size] : [r.name, r.skus];
    lines.push(idv.concat((r.m || []).map(valOf)).map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `sales-${SA.view}-${SA.brand}-${SA.metric}-${dToday()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};

