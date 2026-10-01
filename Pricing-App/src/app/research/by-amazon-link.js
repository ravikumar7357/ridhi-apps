/* ---------- By Amazon link: variation explorer ---------- */
$('go').onclick = async () => {
  const v = $('link').value.trim();
  if (!v) return showMsg('Paste an Amazon link or ASIN first.', true);
  if (!API || !API.url) return showMsg('Backend not configured (Firestore config/api).', true);

  $('go').disabled = true;
  $('go').innerHTML = '<span class="spin"></span>…';
  showMsg('Finding the variations & pulling your sales… (this can take a bit for large families)');
  try {
    const u = new URL(API.url);
    u.searchParams.set('key', API.key);
    u.searchParams.set('children', v);
    const r = await fetch(u, { redirect: 'follow' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Lookup failed');
    renderExplorer(d);
    showMsg('');
  } catch (e) {
    showMsg(e.message || String(e), true);
    $('exResult').classList.add('hide');
  }
  $('go').disabled = false;
  $('go').textContent = 'Explore listings';
};
$('link').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });

function renderExplorer(d) {
  $('exResult').classList.remove('hide');
  $('exHead').textContent = d.title || d.parent;
  $('exSub').innerHTML = `Parent <b>${d.parent}</b> &nbsp;·&nbsp; ${d.count} listing${d.count === 1 ? '' : 's'}`
    + (d.theme ? ` &nbsp;·&nbsp; varies by ${d.theme}` : '') + (d.truncated ? ' &nbsp;·&nbsp; (showing first 60)' : '');

  const dash = '<span class="muted">—</span>';
  let totQty = 0, totAmt = 0, haveSales = false;
  $('exRows').innerHTML = d.children.map(c => {
    if (c.qty30 != null) { totQty += c.qty30; totAmt += c.amt30; haveSales = true; }
    return `<tr>
      <td style="font-family:monospace">${c.asin}</td>
      <td>${c.color || dash}</td>
      <td>${c.size || dash}</td>
      <td style="text-align:right">${c.price > 0 ? money(c.price) : dash}</td>
      <td style="text-align:right">${c.qty30 != null ? c.qty30.toLocaleString('en-IN') : dash}</td>
      <td style="text-align:right">${c.amt30 != null ? money(c.amt30) : dash}</td>
      <td style="text-align:right">${c.bsr > 0 ? '#' + c.bsr.toLocaleString('en-US') : dash}</td>
    </tr>`;
  }).join('');
  $('exTotal').innerHTML = haveSales
    ? `<td colspan="4" style="text-align:right">Your 30-day total</td>
       <td style="text-align:right">${totQty.toLocaleString('en-IN')}</td>
       <td style="text-align:right">${money(totAmt)}</td><td></td>`
    : '';
}

