/* ================= RESEARCH · BY AMAZON LINK: the variation explorer =================
 * Screens: By Amazon Link (hidden from the sidebar — see HIDDEN_TABS in core/nav.js; everything stays wired
 * up). Its message line, msg, is written by showMsg in core/backend.js.
 * Does: Explore listings sends the pasted link or ASIN to the backend (?children=) and lists the parent's
 * variations — ASIN, colour, size, price, your units and sales over 30 days, BSR — with a 30-day total row
 * when sales figures came back (renderExplorer). Enter in the box presses the button.
 * Main functions: renderExplorer, and the go (Explore listings) handler. */

/* ---------- By Amazon link: variation explorer ---------- */
// Explore listings: ask the backend for the family of the pasted link or ASIN and draw it.
$('go').onclick = async () => {
  const linkOrAsin = $('link').value.trim();
  if (!linkOrAsin) return showMsg('Paste an Amazon link or ASIN first.', true);
  if (!API || !API.url) return showMsg('Backend not configured (Firestore config/api).', true);

  // --- busy ---
  $('go').disabled = true;
  $('go').innerHTML = '<span class="spin"></span>…';
  showMsg('Finding the variations & pulling your sales… (this can take a bit for large families)');
  // --- ask the backend and draw ---
  try {
    const url = new URL(API.url);
    url.searchParams.set('key', API.key);
    url.searchParams.set('children', linkOrAsin);
    const res = await fetch(url, { redirect: 'follow' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Lookup failed');
    renderExplorer(data);
    showMsg('');
  } catch (e) {
    showMsg(e.message || String(e), true);
    $('exResult').classList.add('hide');
  }
  // --- back to normal ---
  $('go').disabled = false;
  $('go').textContent = 'Explore listings';
};
// Enter in the box presses Explore listings.
$('link').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('go').click();
});

// Draw one family: the heading, one row per child listing, and the 30-day total row when sales came back.
function renderExplorer(data) {
  // --- heading ---
  $('exResult').classList.remove('hide');
  $('exHead').textContent = data.title || data.parent;
  $('exSub').innerHTML = `Parent <b>${data.parent}</b> &nbsp;·&nbsp; ${data.count} listing${data.count === 1 ? '' : 's'}`
    + (data.theme ? ` &nbsp;·&nbsp; varies by ${data.theme}` : '')
    + (data.truncated ? ' &nbsp;·&nbsp; (showing first 60)' : '');

  // --- one row per child, adding up your sales on the way ---
  const dash = '<span class="ui-dim">—</span>';
  let totQty = 0;          // your units over 30 days, across the children that have sales figures
  let totAmt = 0;          // your sales amount over 30 days
  let haveSales = false;   // at least one child came with sales figures
  $('exRows').innerHTML = data.children.map(child => {
    if (child.qty30 != null) {
      totQty += child.qty30;
      totAmt += child.amt30;
      haveSales = true;
    }
    return `<tr>
      <td class="ui-mono">${child.asin}</td>
      <td>${child.color || dash}</td>
      <td>${child.size || dash}</td>
      <td class="num">${child.price > 0 ? money(child.price) : dash}</td>
      <td class="num">${child.qty30 != null ? child.qty30.toLocaleString('en-IN') : dash}</td>
      <td class="num">${child.amt30 != null ? money(child.amt30) : dash}</td>
      <td class="num">${child.bsr > 0 ? '#' + child.bsr.toLocaleString('en-US') : dash}</td>
    </tr>`;
  }).join('');
  // --- the total row, only when sales figures came back ---
  $('exTotal').innerHTML = haveSales
    ? `<td colspan="4" class="right">Your 30-day total</td>
       <td class="num">${totQty.toLocaleString('en-IN')}</td>
       <td class="num">${money(totAmt)}</td><td></td>`
    : '';
}

