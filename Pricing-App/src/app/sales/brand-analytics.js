/* ---------- Brand Analytics tab (Amazon reports, async) ---------- */
async function baCall(params) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const u = new URL(API.url);
  u.searchParams.set('key', API.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const r = await fetch(u, { redirect: 'follow' });
  // READ IT AS TEXT FIRST.
  //
  // When Apps Script will not run the script for this visitor it answers with a Google HTML page —
  // a sign-in screen or "you need permission" — not JSON. Calling .json() on that threw
  // `Unexpected token '<'`, which says nothing about the actual problem and sent everyone hunting
  // through the app instead of the deployment's access setting.
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) {
    if (/^\s*</.test(text)) {
      throw new Error('The backend answered with a Google web page instead of data — this account '
        + 'is not allowed to run it. In the Apps Script editor: Deploy → Manage deployments '
        + '→ edit → "Who has access" must be Anyone, and "Execute as" must be Me. '
        + '(HTTP ' + r.status + ')');
    }
    throw new Error('The backend sent something that is not data: ' + text.slice(0, 120));
  }
  if (!d.ok && d.status !== 'processing') throw new Error(d.error || 'Report call failed');
  return d;
}
// The ASIN box only applies to the SQP (own products) report; the filter box only to Top terms.
$('baType').addEventListener('change', () => {
  const terms = $('baType').value === 'terms';
  $('baAsinWrap').style.display = terms ? 'none' : '';
  $('baFilterWrap').style.display = terms ? '' : 'none';
});
$('baType').dispatchEvent(new Event('change'));

let BA_RAW = null, BA_KIND = null;
$('baGo').onclick = async () => {
  const type = $('baType').value;
  const asin = $('baAsin').value.trim();
  if (type === 'sqp' && !asin) { baMsg('Enter your ASIN for the product-keywords report.', true); return; }
  $('baGo').disabled = true; $('baGo').innerHTML = '<span class="spin"></span>…';
  try {
    baMsg('Asking Amazon to build the report…');
    const c = await baCall({ ba: 'create', type, period: $('baPeriod').value, asin: type === 'sqp' ? asin : '' });
    if (!c.reportId) throw new Error(c.error || 'Could not create report');
    baMsg(`Report building for ${c.window}… this can take 1–5 minutes.`);
    const rows = await baPollLoop(c.reportId);
    renderBa(rows);
  } catch (e) { baMsg(e.message || String(e), true); $('baResult').classList.add('hide'); }
  $('baGo').disabled = false; $('baGo').textContent = 'Run report';
};
function baMsg(t, bad) { const m = $('baMsg'); m.textContent = t; m.className = bad ? 'err' : 'muted'; }

// Poll every 15s for up to ~8 minutes.
async function baPollLoop(id) {
  for (let i = 0; i < 32; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 8000 : 15000));
    const d = await baCall({ ba: 'poll', id });
    if (d.status === 'done') { BA_RAW = d.sample; BA_KIND = d.kind; return d.rows || []; }
    baMsg(`Report building… (${Math.round((i * 15 + 8) / 6) / 10} min elapsed)`);
  }
  throw new Error('Report is taking too long — try again in a few minutes.');
}

function renderBa(rows) {
  $('baResult').classList.remove('hide');
  const terms = BA_KIND === 'terms';
  const filt = $('baFilter').value.trim().toUpperCase();
  if (terms && filt) rows = rows.filter(r => (r.asin || '').toUpperCase() === filt);
  $('baHead').textContent = terms ? 'Top search terms' : 'My product keywords';
  $('baSub').textContent = `${rows.length} rows${terms && filt ? ' · filtered to ' + filt : ''}`;

  const dash = '<span class="muted">—</span>';
  const n = v => (v == null ? dash : Number(v).toLocaleString('en-US'));
  const pctv = v => (v == null ? dash : (v <= 1 ? (v * 100).toFixed(1) : Number(v).toFixed(1)) + '%');
  let head, body;
  if (terms) {
    head = `<thead><tr><th>Search term</th><th style="text-align:right">Freq rank</th><th>Top ASIN</th>
      <th style="text-align:right">Click rank</th><th style="text-align:right">Click share</th><th style="text-align:right">Conv share</th></tr></thead>`;
    body = rows.map(r => `<tr><td>${r.searchTerm || dash}</td><td style="text-align:right">${n(r.freqRank)}</td>
      <td style="font-family:monospace">${r.asin || dash}${r.title ? '<br><span class="muted">' + r.title.slice(0, 40) + '</span>' : ''}</td>
      <td style="text-align:right">${n(r.clickRank)}</td><td style="text-align:right">${pctv(r.clickShare)}</td><td style="text-align:right">${pctv(r.convShare)}</td></tr>`).join('');
  } else {
    head = `<thead><tr><th>Keyword</th><th style="text-align:right">Search volume</th>
      <th style="text-align:right">Impressions</th><th style="text-align:right">Impr. share</th>
      <th style="text-align:right">Clicks</th><th style="text-align:right">Purchases</th>
      <th style="text-align:right">Market share</th></tr></thead>`;
    body = rows.map(r => `<tr><td>${r.query || dash}</td><td style="text-align:right">${n(r.volume)}</td>
      <td style="text-align:right">${n(r.impressions)}</td><td style="text-align:right">${pctv(r.impShare)}</td>
      <td style="text-align:right">${n(r.clicks)}</td><td style="text-align:right">${n(r.purchases)}</td>
      <td style="text-align:right">${pctv(r.purShare)}</td></tr>`).join('');
  }
  $('baTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="7" class="muted">No rows — data may not be published yet for this period; try Month, or an earlier one.</td></tr>`) + '</tbody>';
}
$('baRawBtn').onclick = () => {
  const raw = $('baRaw'); raw.classList.toggle('hide');
  if (!raw.classList.contains('hide')) raw.textContent = 'First raw row:\n' + JSON.stringify(BA_RAW, null, 2);
};

