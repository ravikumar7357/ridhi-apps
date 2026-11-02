/* ================= RESEARCH · KEYWORDS: the DataDive keyword list for one niche =================
 * Screens: Keywords (hidden from the sidebar — see HIDDEN_TABS in core/nav.js; everything stays wired up).
 * Does: calls DataDive through the backend (ddGet); fills the niche dropdown the first time the screen is
 * opened (loadNiches, called from showTab); on Show keywords pulls the niche's keywords, works out which
 * fields hold the keyword, the search volume and the organic rank (firstArrayOfObjects, pickKey) and lists
 * them biggest volume first with a page number (renderKeywords). Show raw fields reveals the first row as
 * DataDive sent it, so the field mapping can be checked.
 * Main functions: ddGet, loadNiches, firstArrayOfObjects, pickKey, num, renderKeywords. */

/* ---------- Keywords tab (DataDive) ---------- */
// The backend proxies any GET /v1/… DataDive path with the server-held x-api-key.
// One DataDive GET through the backend (?dd=<path>): throws when the backend is not configured or answers
// ok:false, otherwise returns the reply's data.
async function ddGet(path) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const url = new URL(API.url);
  url.searchParams.set('key', API.key);
  url.searchParams.set('dd', path);
  const res = await fetch(url, { redirect: 'follow' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'DataDive call failed');
  return data.data;
}

let NICHES_LOADED = false;   // the niche dropdown has been filled once
let KW_RAW = null;           // the last keywords reply as DataDive sent it, for "Show raw fields"
// Fill the niche dropdown from DataDive, once (showTab calls this every time the Keywords screen opens).
async function loadNiches() {
  if (NICHES_LOADED) return;
  try {
    const reply = await ddGet('/v1/niches?pageSize=50');
    const list = (reply && reply.data) || [];
    if (!list.length) {
      $('kwNiche').innerHTML = '<option value="">No niches in your DataDive account</option>';
      return;
    }
    $('kwNiche').innerHTML = list.map(niche =>
      `<option value="${niche.nicheId}">${(niche.nicheLabel || niche.heroKeyword || niche.nicheId)} · ${niche.marketplace || ''}</option>`).join('');
    NICHES_LOADED = true;
  } catch (e) {
    $('kwNiche').innerHTML = '<option value="">—</option>';
    $('kwMsg').textContent = e.message || String(e);
    $('kwMsg').className = 'err';
  }
}

// The keyword list's exact field names aren't documented, so detect them from the data: find the
// array of keyword objects, then the keyword / volume / rank keys by name pattern. A "raw" view
// exposes the first row so the mapping can be confirmed.
// Walk a reply (at most 6 levels deep, the likely keys first) and return the first array that holds objects,
// or null when there is none.
function firstArrayOfObjects(obj, depth) {
  if (depth > 6 || obj == null) return null;
  if (Array.isArray(obj)) return obj.some(x => x && typeof x === 'object' && !Array.isArray(x)) ? obj : null;
  if (typeof obj === 'object') {
    for (const key of ['keywords', 'data', 'result', 'items', 'rows', 'mkl']) {
      if (obj[key] != null) {
        const found = firstArrayOfObjects(obj[key], depth + 1);
        if (found) return found;
      }
    }
    for (const key in obj) {
      const found = firstArrayOfObjects(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}
// The first key of item that matches one of the patterns, trying the patterns in order; null when none does.
function pickKey(item, pats) {
  for (const pat of pats) {
    for (const key in item) {
      if (pat.test(key)) return key;
    }
  }
  return null;
}
// A number from any value, or null when it is not one. (Top-level: other files shadow it with their own num.)
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Show keywords: pull the chosen niche's keyword list, keep the raw reply for "Show raw fields", draw the table.
$('kwGo').onclick = async () => {
  const id = $('kwNiche').value;
  if (!id) return;
  // --- busy ---
  $('kwGo').disabled = true;
  $('kwGo').innerHTML = '<span class="spin"></span>…';
  $('kwMsg').textContent = 'Pulling keywords from DataDive…';
  $('kwMsg').className = 'muted';
  // --- pull and draw ---
  try {
    const data = await ddGet('/v1/niches/' + id + '/keywords');
    KW_RAW = data;
    renderKeywords(data);
    $('kwMsg').textContent = '';
  } catch (e) {
    $('kwMsg').textContent = e.message || String(e);
    $('kwMsg').className = 'err';
    $('kwResult').classList.add('hide');
  }
  // --- back to normal ---
  $('kwGo').disabled = false;
  $('kwGo').textContent = 'Show keywords';
};

// Draw the keyword table from one reply: find the rows and their fields, sort by search volume (biggest
// first) and turn each organic rank into a page number.
function renderKeywords(data) {
  // --- the rows, and the heading ---
  const arr = firstArrayOfObjects(data, 0) || [];
  $('kwResult').classList.remove('hide');
  const sel = $('kwNiche').options[$('kwNiche').selectedIndex];
  $('kwHead').textContent = sel ? sel.textContent : 'Keywords';
  if (!arr.length) {
    $('kwSub').textContent = 'No keyword rows found — click “Show raw fields”.';
    $('kwRows').innerHTML = '';
    return;
  }

  // --- which field is the keyword, the volume, the rank (read off the first row) ---
  const first = arr[0];
  const kKey = pickKey(first, [/^keyword$/i, /keyword.?(phrase|text)/i, /keyword/i, /phrase/i, /search.?term/i,
    /^term$/i]);
  const vKey = pickKey(first, [/search.?volume/i, /monthly.?search/i, /^volume$/i, /^sv$/i, /searches/i]);
  const rKey = pickKey(first, [/organic.?rank/i, /^rank$/i, /position/i]);
  $('kwSub').innerHTML = `${arr.length} keywords &nbsp;·&nbsp; mapped: keyword=<b>${kKey || '?'}</b>, `
    + `volume=<b>${vKey || '?'}</b>, rank=<b>${rKey || '?'}</b>`;

  // --- the table, biggest volume first ---
  const rows = arr.slice().sort((a, b) => (num(b[vKey]) || 0) - (num(a[vKey]) || 0));
  const dash = '<span class="muted">—</span>';
  $('kwRows').innerHTML = rows.map(row => {
    const rank = rKey ? num(row[rKey]) : null;
    const page = rank && rank > 0 ? Math.ceil(rank / 48) : null;   // ~48 organic results per page (derived)
    return `<tr>
      <td>${kKey ? (row[kKey] ?? dash) : dash}</td>
      <td style="text-align:right">${vKey && num(row[vKey]) != null ? num(row[vKey]).toLocaleString('en-US') : dash}</td>
      <td style="text-align:right">${rank != null ? rank : dash}</td>
      <td style="text-align:right">${page != null ? page : dash}</td>
    </tr>`;
  }).join('');
}
// Show raw fields: toggle the box that shows the first keyword row (or the whole reply) as JSON, cut at
// 4000 characters, so the field mapping above can be checked.
$('kwRawBtn').onclick = () => {
  const raw = $('kwRaw');
  raw.classList.toggle('hide');
  if (!raw.classList.contains('hide')) {
    const arr = firstArrayOfObjects(KW_RAW, 0) || [];
    raw.textContent = 'First keyword row:\n' + JSON.stringify(arr[0] || KW_RAW, null, 2).slice(0, 4000);
  }
};

