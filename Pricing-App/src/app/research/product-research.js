/* ================= RESEARCH · PRODUCT RESEARCH: an Amazon keyword search as a market table =================
 * Screens: Product Research.
 * Does: Search Amazon sends the product name, the outer and inner material (which also filter the hits) and
 * the row count to the backend (?research=) and lists what came back — ASIN link, brand, size, pack,
 * materials, weight, price, BSR, variations, estimated monthly sales (prSearch, renderPr). Export CSV
 * downloads the same rows as a UTF-8 CSV that Excel opens cleanly (the prExport handler). Enter in the
 * search box presses the button.
 * Main functions: prMsg, prSearch, renderPr, and the prExport handler. */

/* ---------- Product research (keyword → market) ---------- */
// The message line beside the Search button: grey normally, red when bad is true.
function prMsg(text, bad) {
  const msg = $('prMsg');
  msg.textContent = text;
  msg.className = bad ? 'err' : 'muted';
}

// Search Amazon: send the product name, the materials and the row count to the backend and draw the results.
async function prSearch() {
  // --- the inputs ---
  const name = $('pr_q').value.trim();
  if (!name) {
    prMsg('Enter a product name to search.', true);
    return;
  }
  // Materials both narrow the keyword search AND filter the results: only hits that actually match
  // the outer/inner material you entered are returned (fo/fi). Each kept hit's own materials still
  // show in the columns.
  const outer = $('pr_outer').value.trim();
  const inner = $('pr_inner').value.trim();
  const query = [name, outer, inner].filter(Boolean).join(' ');
  const count = Math.min(Math.max(parseInt($('pr_count').value, 10) || 20, 1), 100);
  // --- busy ---
  $('prGo').disabled = true;
  $('prGo').innerHTML = '<span class="spin"></span>…';
  prMsg('Searching Amazon…');
  // --- ask the backend and draw ---
  try {
    if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
    const url = new URL(API.url);
    url.searchParams.set('key', API.key);
    url.searchParams.set('research', query);
    url.searchParams.set('count', count);
    if (outer) url.searchParams.set('fo', outer);
    if (inner) url.searchParams.set('fi', inner);
    const res = await fetch(url, { redirect: 'follow' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Search failed');
    renderPr(data);
    prMsg('');
  } catch (e) {
    prMsg(e.message || String(e), true);
    $('prResult').classList.add('hide');
  }
  // --- back to normal ---
  $('prGo').disabled = false;
  $('prGo').textContent = 'Search Amazon';
}
// The button, and Enter in the search box.
$('prGo').onclick = prSearch;
$('pr_q').addEventListener('keydown', e => {
  if (e.key === 'Enter') prSearch();
});

let PR_ROWS = [];     // the rows on view, for Export CSV
let PR_QUERY = '';    // the query they came from, for the CSV file name
// Draw one search reply: the heading (with the backend's counts when it sent them) and the table; keep the
// rows for Export CSV.
function renderPr(data) {
  const rows = data.rows || [];
  PR_ROWS = rows;
  PR_QUERY = data.query || '';
  const esc = str => String(str == null ? '' : str)
    .replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // --- heading ---
  $('prResult').classList.remove('hide');
  let headTxt = `${rows.length} result${rows.length === 1 ? '' : 's'} for "${data.query}"`;
  const dbg = data.dbg;
  if (dbg) {
    if (dbg.filtered) headTxt += ` · ${rows.length} matched the material filter (of ${dbg.scanned} scanned)`;
    headTxt += ` · ${dbg.priced}/${rows.length} priced`;
    if (dbg.pageErr) headTxt += ` · note: ${dbg.pageErr}`;
    if (dbg.priceErr) headTxt += ` · ${dbg.priceErr}`;
  }
  $('prHead').textContent = headTxt;
  $('prExport').style.display = rows.length ? '' : 'none';
  if (!rows.length) {
    $('prTable').innerHTML = '<tr><td class="ui-empty">No products found — try broader keywords.</td></tr>';
    return;
  }
  // --- the table ---
  const head = '<thead><tr><th>Link</th><th>Brand</th><th>Size</th><th class="num">Pack</th><th>Outer Material</th>' +
    '<th>Inner Material</th><th class="num">Weight (lb)</th><th class="num">Selling Price</th><th class="num">BSR</th>' +
    '<th class="num">Variations</th><th class="num">Sale Qty <span class="muted">(est/mo)</span></th></tr></thead>';
  const body = rows.map(row => {
    // Show only the ASIN as the link (short, no wrapping → smaller rows, less lag); the full product
    // name lives in the hover tooltip and still exports to CSV.
    const prod = row.asin
      ? `<a class="ui-mono" href="https://www.amazon.com/dp/${row.asin}" target="_blank" rel="noopener" `
        + `title="${esc(row.title)}">${row.asin}</a>`
      : (esc((row.title || '').slice(0, 40)) || '—');
    return `<tr><td>${prod}</td><td>${esc(row.brand) || '—'}</td><td>${esc(row.size) || '—'}</td>` +
      `<td class="num">${row.pack > 0 ? row.pack : '—'}</td>` +
      `<td>${esc(row.outer) || '—'}</td><td>${esc(row.inner) || '—'}</td>` +
      `<td class="num">${row.weight > 0 ? row.weight : '—'}</td>` +
      `<td class="num">${row.price > 0 ? money(row.price) : '—'}</td>` +
      `<td class="num">${row.bsr > 0 ? '#' + row.bsr.toLocaleString() : '—'}</td>` +
      `<td class="num">${row.variations > 0 ? row.variations : '—'}</td>` +
      `<td class="num">${row.saleQtyEst != null ? '~' + row.saleQtyEst.toLocaleString() : '—'}</td></tr>`;
  }).join('');
  $('prTable').innerHTML = head + '<tbody>' + body + '</tbody>';
}

// Export the current results to a CSV Excel opens cleanly (UTF-8 BOM + CRLF, quoted fields).
$('prExport').onclick = () => {
  if (!PR_ROWS.length) return;
  // --- the rows as CSV text ---
  const quote = str => '"' + String(str == null ? '' : str).replace(/"/g, '""') + '"';
  const cols = ['Product', 'ASIN', 'Brand', 'Size', 'Pack', 'Outer Material', 'Inner Material',
    'Weight (lb)', 'Selling Price', 'BSR', 'Variations', 'Sale Qty (est/mo)'];
  const lines = [cols.map(quote).join(',')];
  PR_ROWS.forEach(row => lines.push([
    row.title || '', row.asin || '', row.brand || '', row.size || '', row.pack > 0 ? row.pack : '',
    row.outer || '', row.inner || '',
    row.weight > 0 ? row.weight : '', row.price > 0 ? row.price : '', row.bsr > 0 ? row.bsr : '',
    row.variations > 0 ? row.variations : '', row.saleQtyEst != null ? row.saleQtyEst : '',
  ].map(quote).join(',')));
  // The string below starts with an invisible character: the UTF-8 byte-order mark (U+FEFF), which makes
  // Excel read the file as UTF-8.
  const csv = '﻿' + lines.join('\r\n');
  // --- download it, named after the query ---
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const slug = (PR_QUERY || 'products').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '');
  anchor.href = url;
  anchor.download = `product-research-${slug || 'results'}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

