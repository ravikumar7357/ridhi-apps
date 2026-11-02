/* ================= LISTING · BOUGHT TOGETHER: Amazon's Market Basket report for the whole catalogue =================
 * Screens: Bought Together (tab 'basket').
 * Does: fills the period picker, asks the backend (baCall) for the Market Basket report and polls until Amazon has built it,
 *       then shows it in one of two views — products that are NOT yours bought beside yours (gaps), or two of yours bought
 *       together (pairs) — with a search box over either table.
 * Main functions: mbMsg, ensureBasket, mbFillPeriods, the Go handler, renderBasketAll. */
/* ================= BOUGHT TOGETHER =================
 *
 * Amazon's Market Basket report, across the whole catalogue. It is brand-wide — one report answers
 * for every product — which is why this is a screen rather than a card on one listing.
 *
 * TWO BUCKETS, because the two answers call for opposite work. A single "bought together" list looks
 * interesting and cannot be acted on: nothing can be decided about a row until you know whose the
 * other product is.
 */
let MB = null;          // the last Market Basket report that came back (the basketAll reply), or null
let MB_ID = '';         // the report Amazon is still building, so another press keeps waiting instead of asking again
let MB_VIEW = 'gaps';   // 'gaps' = products that are not yours, 'pairs' = two of yours bought together

// Status line under the toolbar: red for an error, grey otherwise. Does nothing if the pane is not on the page.
function mbMsg(text, bad) {
  const el = $('mbMsg');
  if (el) {
    el.textContent = text || '';
    el.className = bad ? 'err' : 'muted';
  }
}

// First visit to the tab: fill the period picker once.
async function ensureBasket() {
  if (!$('mbWhich').options.length) await mbFillPeriods();
}

// Fill the "which period" picker from the backend for the chosen period type; a new window means a new report.
async function mbFillPeriods() {
  const sel = $('mbWhich');
  sel.innerHTML = '<option>…</option>';
  try {
    const reply = await baCall({ listing: 'periods', period: $('mbPeriod').value, n: 12 });
    sel.innerHTML = (reply.periods || []).map(period => `<option value="${period.back}">${loEsc(period.label)}</option>`).join('');
    MB = null;                    // a different window is a different report
    MB_ID = '';
    $('mbBody').innerHTML = '';
  } catch (e) {
    sel.innerHTML = '<option value="0">most recent complete</option>';
  }
}

// Period type changed: refill the picker.
$('mbPeriod').onchange = mbFillPeriods;
// Go: ask Amazon for the report (or keep waiting for the one already asked for), poll until it is done, then draw it.
$('mbGo').onclick = async () => {
  const btn = $('mbGo');
  btn.disabled = true;
  try {
    if (!MB_ID) {
      // --- ask for the report ---
      mbMsg('Asking Amazon for the Market Basket report…');
      const askReply = await baCall({ listing: 'basketAsk', brand: $('mbBrand').value,
        period: $('mbPeriod').value, back: $('mbWhich').value || '0' });
      if (!askReply.reportId) throw new Error(askReply.error || 'Amazon did not accept the request.');
      MB_ID = askReply.reportId;
      mbMsg(`Building ${askReply.label || ''} (${askReply.window}). Amazon takes a few minutes.`);
    }
    // --- poll until it is done: at most 24 tries, 15 s apart ---
    // Bounded polling. An open loop against a rate-limited API is how an account gets throttled for
    // the rest of the day.
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      mbMsg(`Waiting for Amazon… ${(i + 1) * 15}s`);
      const pollReply = await baCall({ listing: 'basketAll', id: MB_ID, brand: $('mbBrand').value });
      if (pollReply.ok && pollReply.status === 'done') {
        MB = pollReply;
        MB_ID = '';
        renderBasketAll();
        return;
      }
      if (!pollReply.ok && /FATAL|CANCELLED/i.test(String(pollReply.error || ''))) throw new Error(pollReply.error);
    }
    mbMsg('Still building. Press again to keep waiting — the report is not lost.');
  } catch (e) {
    mbMsg('Could not get it: ' + (e.message || e), true);
    MB_ID = '';
  } finally {
    btn.disabled = false;
  }
};

// The two view buttons: switch between "not yours" (gaps) and "both yours" (pairs) and redraw.
['mbGaps', 'mbPairs'].forEach(id => {
  $(id).onclick = () => {
    MB_VIEW = id === 'mbGaps' ? 'gaps' : 'pairs';
    ['mbGaps', 'mbPairs'].forEach(btnId => $(btnId).classList.toggle('on', btnId === id));
    renderBasketAll();
  };
});

// Draw the report in the current view, filtered by the search box: the status line, then one table.
function renderBasketAll() {
  const report = MB;
  if (!report) return;
  const search = ($('mbFilter').value || '').trim().toLowerCase();

  // --- nothing in the report could be read ---
  if (!report.rows) {
    $('mbBody').innerHTML = `<div class="card" style="padding:14px"><div class="muted">
      Amazon returned ${report.total || 0} row(s) and none of them could be read as an ASIN pair.
      If that is every row, the report's field names are not what this expects — run
      <b>basketTest</b> in the Apps Script editor, which prints a raw row.</div></div>`;
    mbMsg('');
    return;
  }

  // --- status line ---
  mbMsg(`${report.rows} pairing(s) across ${report.asins} of your ASIN(s) · `
    + `${report.pairs.length} bundle candidate(s) · ${report.gaps.length} product(s) that are not yours`
    + (report.catalogueKnown ? '' : ' · the Catalog tab could not be read, so "whose" is unknown'));

  // --- pairs view: both products are yours ---
  if (MB_VIEW === 'pairs') {
    const rows = report.pairs.filter(pair => !search
      || (pair.a + ' ' + pair.b + ' ' + pair.aSku + ' ' + pair.bSku + ' ' + pair.title).toLowerCase().includes(search));
    $('mbBody').innerHTML = `<div class="card" style="padding:12px 14px">
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Both products are YOURS and customers already buy them together. A bundle, a virtual bundle or
        a cross-sell here captures something that is happening anyway — nothing to source, nothing to make.
        Each pair appears ONCE: Amazon reports A-with-B and B-with-A separately, and showing both would
        make twenty ideas look like forty.
      </div>
      ${rows.length ? `<table class="xl" style="font-size:12px"><thead><tr>
        <th>Product</th><th>Bought with</th>
        <th class="num" title="Share of baskets containing one of them that also contained the other.`
        + ` The higher of the two directions.">Share</th>
        </tr></thead><tbody>`
        + rows.map(pair => `<tr>
            <td class="mono">${loEsc(pair.aSku || pair.a)}`
              + `<div class="muted" style="font-size:10.5px">${loEsc(pair.a)}</div></td>
            <td class="mono">${loEsc(pair.bSku || pair.b)}`
              + `<div class="muted" style="font-size:10.5px">${loEsc(pair.title || pair.b)}</div></td>
            <td class="num">${pair.share ? pair.share + '%' : '—'}</td></tr>`).join('')
        + '</tbody></table>'
        : '<div class="muted">No pairing where both products are yours.</div>'}
    </div>`;
    return;
  }

  // --- gaps view: products that are not yours ---
  const rows = report.gaps.filter(gap => !search || (gap.asin + ' ' + gap.title).toLowerCase().includes(search));
  $('mbBody').innerHTML = `<div class="card" style="padding:12px 14px">
    <div class="muted" style="font-size:12px;margin-bottom:8px">
      These are NOT your products, and customers put them in the same basket as yours. Each one is
      something the customer wanted alongside your product and bought from somebody else.
      <b>Ranked by how many of your ASINs it pairs with, not by a single share</b> — a product that
      turns up beside twenty of yours is a hole in the range; one that turns up beside a single ASIN
      at a high share is that ASIN's accessory. Both are worth knowing and they are not the same thing.
    </div>
    ${rows.length ? `<table class="xl" style="font-size:12px"><thead><tr>
      <th>Not yours</th><th>Product</th>
      <th class="num" title="How many of YOUR ASINs this product shares a basket with.">Pairs with</th>
      <th class="num" title="Its highest share of baskets against any one of your products.">Best share</th>
      <th>Yours it appears beside</th></tr></thead><tbody>`
      + rows.map(gap => `<tr>
          <td class="mono">${loEsc(gap.asin)}</td>
          <td>${loEsc(gap.title) || '<span class="muted">—</span>'}</td>
          <td class="num"><b>${gap.n}</b></td>
          <td class="num">${gap.best ? gap.best + '%' : '—'}</td>
          <td class="muted" style="font-size:11px">${gap.with.map(yours => loEsc(yours.sku || yours.asin)).join(', ')}</td>
        </tr>`).join('')
      + '</tbody></table>'
      : '<div class="muted">Nothing outside your own catalogue shares a basket with your products.</div>'}
  </div>`;
}
// Typing in the search box filters the table that is on screen.
$('mbFilter').addEventListener('input', () => {
  if (MB) renderBasketAll();
});


