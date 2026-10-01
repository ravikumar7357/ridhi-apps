/* ---------- Product research (keyword → market) ---------- */
function prMsg(t, bad) { const m = $('prMsg'); m.textContent = t; m.className = bad ? 'err' : 'muted'; }

async function prSearch() {
  const q = $('pr_q').value.trim();
  if (!q) { prMsg('Enter a product name to search.', true); return; }
  // Materials both narrow the keyword search AND filter the results: only hits that actually match
  // the outer/inner material you entered are returned (fo/fi). Each kept hit's own materials still
  // show in the columns.
  const outer = $('pr_outer').value.trim(), inner = $('pr_inner').value.trim();
  const query = [q, outer, inner].filter(Boolean).join(' ');
  const count = Math.min(Math.max(parseInt($('pr_count').value, 10) || 20, 1), 100);
  $('prGo').disabled = true; $('prGo').innerHTML = '<span class="spin"></span>…';
  prMsg('Searching Amazon…');
  try {
    if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
    const u = new URL(API.url);
    u.searchParams.set('key', API.key);
    u.searchParams.set('research', query);
    u.searchParams.set('count', count);
    if (outer) u.searchParams.set('fo', outer);
    if (inner) u.searchParams.set('fi', inner);
    const r = await fetch(u, { redirect: 'follow' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Search failed');
    renderPr(d);
    prMsg('');
  } catch (e) { prMsg(e.message || String(e), true); $('prResult').classList.add('hide'); }
  $('prGo').disabled = false; $('prGo').textContent = 'Search Amazon';
}
$('prGo').onclick = prSearch;
$('pr_q').addEventListener('keydown', e => { if (e.key === 'Enter') prSearch(); });

let PR_ROWS = [], PR_QUERY = '';
function renderPr(d) {
  const rows = d.rows || [];
  PR_ROWS = rows; PR_QUERY = d.query || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('prResult').classList.remove('hide');
  let headTxt = `${rows.length} result${rows.length === 1 ? '' : 's'} for "${d.query}"`;
  const g = d.dbg;
  if (g) {
    if (g.filtered) headTxt += ` · ${rows.length} matched the material filter (of ${g.scanned} scanned)`;
    headTxt += ` · ${g.priced}/${rows.length} priced`;
    if (g.pageErr) headTxt += ` · note: ${g.pageErr}`;
    if (g.priceErr) headTxt += ` · ${g.priceErr}`;
  }
  $('prHead').textContent = headTxt;
  $('prExport').style.display = rows.length ? '' : 'none';
  if (!rows.length) { $('prTable').innerHTML = '<tr><td class="muted">No products found — try broader keywords.</td></tr>'; return; }
  const head = '<thead><tr><th>Link</th><th>Brand</th><th>Size</th><th>Pack</th><th>Outer Material</th>' +
    '<th>Inner Material</th><th>Weight (lb)</th><th>Selling Price</th><th>BSR</th>' +
    '<th>Variations</th><th>Sale Qty <span class="muted">(est/mo)</span></th></tr></thead>';
  const body = rows.map(r => {
    // Show only the ASIN as the link (short, no wrapping → smaller rows, less lag); the full product
    // name lives in the hover tooltip and still exports to CSV.
    const prod = r.asin
      ? `<a href="https://www.amazon.com/dp/${r.asin}" target="_blank" rel="noopener" title="${esc(r.title)}">${r.asin}</a>`
      : (esc((r.title || '').slice(0, 40)) || '—');
    return `<tr><td>${prod}</td><td>${esc(r.brand) || '—'}</td><td>${esc(r.size) || '—'}</td>` +
      `<td>${r.pack > 0 ? r.pack : '—'}</td>` +
      `<td>${esc(r.outer) || '—'}</td><td>${esc(r.inner) || '—'}</td>` +
      `<td>${r.weight > 0 ? r.weight : '—'}</td>` +
      `<td>${r.price > 0 ? money(r.price) : '—'}</td>` +
      `<td>${r.bsr > 0 ? '#' + r.bsr.toLocaleString() : '—'}</td>` +
      `<td>${r.variations > 0 ? r.variations : '—'}</td>` +
      `<td>${r.saleQtyEst != null ? '~' + r.saleQtyEst.toLocaleString() : '—'}</td></tr>`;
  }).join('');
  $('prTable').innerHTML = head + '<tbody>' + body + '</tbody>';
}

// Export the current results to a CSV Excel opens cleanly (UTF-8 BOM + CRLF, quoted fields).
$('prExport').onclick = () => {
  if (!PR_ROWS.length) return;
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const cols = ['Product', 'ASIN', 'Brand', 'Size', 'Pack', 'Outer Material', 'Inner Material',
    'Weight (lb)', 'Selling Price', 'BSR', 'Variations', 'Sale Qty (est/mo)'];
  const lines = [cols.map(q).join(',')];
  PR_ROWS.forEach(r => lines.push([
    r.title || '', r.asin || '', r.brand || '', r.size || '', r.pack > 0 ? r.pack : '',
    r.outer || '', r.inner || '',
    r.weight > 0 ? r.weight : '', r.price > 0 ? r.price : '', r.bsr > 0 ? r.bsr : '',
    r.variations > 0 ? r.variations : '', r.saleQtyEst != null ? r.saleQtyEst : '',
  ].map(q).join(',')));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (PR_QUERY || 'products').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '');
  a.href = url; a.download = `product-research-${slug || 'results'}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

