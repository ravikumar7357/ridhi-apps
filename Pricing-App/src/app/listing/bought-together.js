/* ================= BOUGHT TOGETHER =================
 *
 * Amazon's Market Basket report, across the whole catalogue. It is brand-wide — one report answers
 * for every product — which is why this is a screen rather than a card on one listing.
 *
 * TWO BUCKETS, because the two answers call for opposite work. A single "bought together" list looks
 * interesting and cannot be acted on: nothing can be decided about a row until you know whose the
 * other product is.
 */
let MB = null, MB_ID = '', MB_VIEW = 'gaps';

function mbMsg(t, bad) { const el = $('mbMsg'); if (el) { el.textContent = t || ''; el.className = bad ? 'err' : 'muted'; } }

async function ensureBasket() {
  if (!$('mbWhich').options.length) await mbFillPeriods();
}

async function mbFillPeriods() {
  const sel = $('mbWhich');
  sel.innerHTML = '<option>…</option>';
  try {
    const r = await baCall({ listing: 'periods', period: $('mbPeriod').value, n: 12 });
    sel.innerHTML = (r.periods || []).map(x => `<option value="${x.back}">${loEsc(x.label)}</option>`).join('');
    MB = null; MB_ID = ''; $('mbBody').innerHTML = '';       // a different window is a different report
  } catch (e) { sel.innerHTML = '<option value="0">most recent complete</option>'; }
}

$('mbPeriod').onchange = mbFillPeriods;
$('mbGo').onclick = async () => {
  const btn = $('mbGo');
  btn.disabled = true;
  try {
    if (!MB_ID) {
      mbMsg('Asking Amazon for the Market Basket report…');
      const r = await baCall({ listing: 'basketAsk', brand: $('mbBrand').value,
        period: $('mbPeriod').value, back: $('mbWhich').value || '0' });
      if (!r.reportId) throw new Error(r.error || 'Amazon did not accept the request.');
      MB_ID = r.reportId;
      mbMsg(`Building ${r.label || ''} (${r.window}). Amazon takes a few minutes.`);
    }
    // Bounded polling. An open loop against a rate-limited API is how an account gets throttled for
    // the rest of the day.
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 15000));
      mbMsg(`Waiting for Amazon… ${(i + 1) * 15}s`);
      const g = await baCall({ listing: 'basketAll', id: MB_ID, brand: $('mbBrand').value });
      if (g.ok && g.status === 'done') { MB = g; MB_ID = ''; renderBasketAll(); return; }
      if (!g.ok && /FATAL|CANCELLED/i.test(String(g.error || ''))) throw new Error(g.error);
    }
    mbMsg('Still building. Press again to keep waiting — the report is not lost.');
  } catch (e) {
    mbMsg('Could not get it: ' + (e.message || e), true);
    MB_ID = '';
  } finally { btn.disabled = false; }
};

['mbGaps', 'mbPairs'].forEach(id => {
  $(id).onclick = () => {
    MB_VIEW = id === 'mbGaps' ? 'gaps' : 'pairs';
    ['mbGaps', 'mbPairs'].forEach(x => $(x).classList.toggle('on', x === id));
    renderBasketAll();
  };
});

function renderBasketAll() {
  const g = MB; if (!g) return;
  const q = ($('mbFilter').value || '').trim().toLowerCase();

  if (!g.rows) {
    $('mbBody').innerHTML = `<div class="card" style="padding:14px"><div class="muted">
      Amazon returned ${g.total || 0} row(s) and none of them could be read as an ASIN pair.
      If that is every row, the report's field names are not what this expects — run
      <b>basketTest</b> in the Apps Script editor, which prints a raw row.</div></div>`;
    mbMsg('');
    return;
  }

  mbMsg(`${g.rows} pairing(s) across ${g.asins} of your ASIN(s) · `
    + `${g.pairs.length} bundle candidate(s) · ${g.gaps.length} product(s) that are not yours`
    + (g.catalogueKnown ? '' : ' · the Catalog tab could not be read, so "whose" is unknown'));

  if (MB_VIEW === 'pairs') {
    const rows = g.pairs.filter(p => !q
      || (p.a + ' ' + p.b + ' ' + p.aSku + ' ' + p.bSku + ' ' + p.title).toLowerCase().includes(q));
    $('mbBody').innerHTML = `<div class="card" style="padding:12px 14px">
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Both products are YOURS and customers already buy them together. A bundle, a virtual bundle or
        a cross-sell here captures something that is happening anyway — nothing to source, nothing to make.
        Each pair appears ONCE: Amazon reports A-with-B and B-with-A separately, and showing both would
        make twenty ideas look like forty.
      </div>
      ${rows.length ? `<table class="xl" style="font-size:12px"><thead><tr>
        <th>Product</th><th>Bought with</th>
        <th class="num" title="Share of baskets containing one of them that also contained the other. The higher of the two directions.">Share</th>
        </tr></thead><tbody>`
        + rows.map(p => `<tr>
            <td class="mono">${loEsc(p.aSku || p.a)}<div class="muted" style="font-size:10.5px">${loEsc(p.a)}</div></td>
            <td class="mono">${loEsc(p.bSku || p.b)}<div class="muted" style="font-size:10.5px">${loEsc(p.title || p.b)}</div></td>
            <td class="num">${p.share ? p.share + '%' : '—'}</td></tr>`).join('')
        + '</tbody></table>'
        : '<div class="muted">No pairing where both products are yours.</div>'}
    </div>`;
    return;
  }

  const rows = g.gaps.filter(x => !q || (x.asin + ' ' + x.title).toLowerCase().includes(q));
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
      + rows.map(x => `<tr>
          <td class="mono">${loEsc(x.asin)}</td>
          <td>${loEsc(x.title) || '<span class="muted">—</span>'}</td>
          <td class="num"><b>${x.n}</b></td>
          <td class="num">${x.best ? x.best + '%' : '—'}</td>
          <td class="muted" style="font-size:11px">${x.with.map(w => loEsc(w.sku || w.asin)).join(', ')}</td>
        </tr>`).join('')
      + '</tbody></table>'
      : '<div class="muted">Nothing outside your own catalogue shares a basket with your products.</div>'}
  </div>`;
}
$('mbFilter').addEventListener('input', () => { if (MB) renderBasketAll(); });


