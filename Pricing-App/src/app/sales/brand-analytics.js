/* ================= SALES · BRAND ANALYTICS: the Analytics screen, and baCall, the backend GET every screen uses =================
 * Screens: Analytics (hidden from the sidebar — see HIDDEN_TABS in core/nav.js; everything stays wired up).
 * baCall itself is called from almost every other screen: ads, listing, inventory and the other sales files
 * all fetch through it (imPost in listing/image-manager.js is the one POST).
 * Does: baCall is one GET to the backend (Apps Script) with any set of query parameters; it reads the answer
 * as text first, so a Google sign-in page gets a clear message instead of a JSON error. On this screen,
 * Run report asks Amazon for one of its Brand Analytics reports for the period chosen — "My product keywords"
 * (Search Query Performance for one of your ASINs) or "Top search terms" — waits until it is built
 * (baPollLoop) and draws the rows (renderBa). Show raw fields reveals the first row as Amazon sent it.
 * Main functions: baCall, baMsg, baPollLoop, renderBa, and the baGo (Run report) handler. */

/* ---------- Brand Analytics tab (Amazon reports, async) ---------- */
// One GET to the backend: ?key=… plus every parameter given (null and blank ones left out). Throws when the
// backend is not configured, answers with a web page, or says ok:false (unless its status is "processing").
// Returns the parsed answer.
async function baCall(params) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const url = new URL(API.url);
  url.searchParams.set('key', API.key);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const res = await fetch(url, { redirect: 'follow' });
  // READ IT AS TEXT FIRST.
  //
  // When Apps Script will not run the script for this visitor it answers with a Google HTML page —
  // a sign-in screen or "you need permission" — not JSON. Calling .json() on that threw
  // `Unexpected token '<'`, which says nothing about the actual problem and sent everyone hunting
  // through the app instead of the deployment's access setting.
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    if (/^\s*</.test(text)) {
      throw new Error('The backend answered with a Google web page instead of data — this account '
        + 'is not allowed to run it. In the Apps Script editor: Deploy → Manage deployments '
        + '→ edit → "Who has access" must be Anyone, and "Execute as" must be Me. '
        + '(HTTP ' + res.status + ')');
    }
    throw new Error('The backend sent something that is not data: ' + text.slice(0, 120));
  }
  if (!data.ok && data.status !== 'processing') throw new Error(data.error || 'Report call failed');
  return data;
}

/* ---- the Analytics screen ---- */
// The ASIN box only applies to the SQP (own products) report; the filter box only to Top terms.
$('baType').addEventListener('change', () => {
  const terms = $('baType').value === 'terms';
  $('baAsinWrap').style.display = terms ? 'none' : '';
  $('baFilterWrap').style.display = terms ? '' : 'none';
});
// Run that once at start, so the boxes match the choice the page loads with.
$('baType').dispatchEvent(new Event('change'));

let BA_RAW = null;    // the first raw row of the last report, for "Show raw fields"
let BA_KIND = null;   // what the backend says the rows are: 'terms' = Top search terms; anything else draws the SQP columns
// Run report: have Amazon build the chosen report, wait for it, draw it.
$('baGo').onclick = async () => {
  const type = $('baType').value;
  const asin = $('baAsin').value.trim();
  if (type === 'sqp' && !asin) {
    baMsg('Enter your ASIN for the product-keywords report.', true);
    return;
  }
  // --- busy ---
  $('baGo').disabled = true;
  $('baGo').innerHTML = '<span class="spin"></span>…';
  // --- create the report, wait for it, draw it ---
  try {
    baMsg('Asking Amazon to build the report…');
    const created = await baCall({ ba: 'create', type, period: $('baPeriod').value, asin: type === 'sqp' ? asin : '' });
    if (!created.reportId) throw new Error(created.error || 'Could not create report');
    baMsg(`Report building for ${created.window}… this can take 1–5 minutes.`);
    const rows = await baPollLoop(created.reportId);
    renderBa(rows);
  } catch (e) {
    baMsg(e.message || String(e), true);
    $('baResult').classList.add('hide');
  }
  // --- back to normal ---
  $('baGo').disabled = false;
  $('baGo').textContent = 'Run report';
};
// The message line under the button: grey normally, red when bad is true.
function baMsg(text, bad) {
  const msg = $('baMsg');
  msg.textContent = text;
  msg.className = bad ? 'err' : 'muted';
}

// Poll every 15s for up to ~8 minutes.
// Ask the backend about the report until it is done (8 s before the first ask, then 15 s between asks, 32 asks
// at most): keep the sample row and the kind, return the rows. Throws when it is still not done after that.
async function baPollLoop(id) {
  for (let i = 0; i < 32; i++) {
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 8000 : 15000));
    const data = await baCall({ ba: 'poll', id });
    if (data.status === 'done') {
      BA_RAW = data.sample;
      BA_KIND = data.kind;
      return data.rows || [];
    }
    baMsg(`Report building… (${Math.round((i * 15 + 8) / 6) / 10} min elapsed)`);
  }
  throw new Error('Report is taking too long — try again in a few minutes.');
}

// Draw the rows of one report: Top search terms (filtered to one ASIN when the filter box is filled) or
// My product keywords.
function renderBa(rows) {
  // --- heading ---
  $('baResult').classList.remove('hide');
  const terms = BA_KIND === 'terms';
  const filt = $('baFilter').value.trim().toUpperCase();
  if (terms && filt) rows = rows.filter(row => (row.asin || '').toUpperCase() === filt);
  $('baHead').textContent = terms ? 'Top search terms' : 'My product keywords';
  $('baSub').textContent = `${rows.length} rows${terms && filt ? ' · filtered to ' + filt : ''}`;

  // --- the table ---
  const dash = '<span class="ui-dim">—</span>';
  // a count with thousands separators, or — ; a share: a fraction (≤ 1) becomes a %, a value already in % stays
  const fmtNum = value => (value == null ? dash : Number(value).toLocaleString('en-US'));
  const pctv = value => (value == null ? dash : (value <= 1 ? (value * 100).toFixed(1) : Number(value).toFixed(1)) + '%');
  let head, body;
  if (terms) {
    head = `<thead><tr><th>Search term</th><th class="num">Freq rank</th><th>Top ASIN</th>
      <th class="num">Click rank</th><th class="num">Click share</th>`
      + `<th class="num">Conv share</th></tr></thead>`;
    body = rows.map(row => `<tr><td>${row.searchTerm || dash}</td><td class="num">${fmtNum(row.freqRank)}</td>
      <td class="ui-mono">${row.asin || dash}`
      + `${row.title ? '<br><span class="muted">' + row.title.slice(0, 40) + '</span>' : ''}</td>
      <td class="num">${fmtNum(row.clickRank)}</td><td class="num">${pctv(row.clickShare)}</td>`
      + `<td class="num">${pctv(row.convShare)}</td></tr>`).join('');
  } else {
    head = `<thead><tr><th>Keyword</th><th class="num">Search volume</th>
      <th class="num">Impressions</th><th class="num">Impr. share</th>
      <th class="num">Clicks</th><th class="num">Purchases</th>
      <th class="num">Market share</th></tr></thead>`;
    body = rows.map(row => `<tr><td>${row.query || dash}</td><td class="num">${fmtNum(row.volume)}</td>
      <td class="num">${fmtNum(row.impressions)}</td><td class="num">${pctv(row.impShare)}</td>
      <td class="num">${fmtNum(row.clicks)}</td><td class="num">${fmtNum(row.purchases)}</td>
      <td class="num">${pctv(row.purShare)}</td></tr>`).join('');
  }
  $('baTable').innerHTML = head + '<tbody>'
    + (body || `<tr><td colspan="7" class="ui-empty">No rows — data may not be published yet for this period; `
      + `try Month, or an earlier one.</td></tr>`)
    + '</tbody>';
}
// Show raw fields: toggle the box with the report's first raw row as JSON.
$('baRawBtn').onclick = () => {
  const raw = $('baRaw');
  raw.classList.toggle('hide');
  if (!raw.classList.contains('hide')) raw.textContent = 'First raw row:\n' + JSON.stringify(BA_RAW, null, 2);
};

