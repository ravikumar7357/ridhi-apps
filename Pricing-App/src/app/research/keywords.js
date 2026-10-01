/* ---------- Keywords tab (DataDive) ---------- */
// The backend proxies any GET /v1/… DataDive path with the server-held x-api-key.
async function ddGet(path) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const u = new URL(API.url);
  u.searchParams.set('key', API.key);
  u.searchParams.set('dd', path);
  const r = await fetch(u, { redirect: 'follow' });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'DataDive call failed');
  return d.data;
}

let NICHES_LOADED = false, KW_RAW = null;
async function loadNiches() {
  if (NICHES_LOADED) return;
  try {
    const d = await ddGet('/v1/niches?pageSize=50');
    const list = (d && d.data) || [];
    if (!list.length) { $('kwNiche').innerHTML = '<option value="">No niches in your DataDive account</option>'; return; }
    $('kwNiche').innerHTML = list.map(n =>
      `<option value="${n.nicheId}">${(n.nicheLabel || n.heroKeyword || n.nicheId)} · ${n.marketplace || ''}</option>`).join('');
    NICHES_LOADED = true;
  } catch (e) {
    $('kwNiche').innerHTML = '<option value="">—</option>';
    $('kwMsg').textContent = e.message || String(e); $('kwMsg').className = 'err';
  }
}

// The keyword list's exact field names aren't documented, so detect them from the data: find the
// array of keyword objects, then the keyword / volume / rank keys by name pattern. A "raw" view
// exposes the first row so the mapping can be confirmed.
function firstArrayOfObjects(o, depth) {
  if (depth > 6 || o == null) return null;
  if (Array.isArray(o)) return o.some(x => x && typeof x === 'object' && !Array.isArray(x)) ? o : null;
  if (typeof o === 'object') {
    for (const k of ['keywords', 'data', 'result', 'items', 'rows', 'mkl']) {
      if (o[k] != null) { const a = firstArrayOfObjects(o[k], depth + 1); if (a) return a; }
    }
    for (const k in o) { const a = firstArrayOfObjects(o[k], depth + 1); if (a) return a; }
  }
  return null;
}
function pickKey(item, pats) {
  for (const p of pats) for (const k in item) if (p.test(k)) return k;
  return null;
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

$('kwGo').onclick = async () => {
  const id = $('kwNiche').value;
  if (!id) return;
  $('kwGo').disabled = true; $('kwGo').innerHTML = '<span class="spin"></span>…';
  $('kwMsg').textContent = 'Pulling keywords from DataDive…'; $('kwMsg').className = 'muted';
  try {
    const d = await ddGet('/v1/niches/' + id + '/keywords');
    KW_RAW = d;
    renderKeywords(d);
    $('kwMsg').textContent = '';
  } catch (e) { $('kwMsg').textContent = e.message || String(e); $('kwMsg').className = 'err'; $('kwResult').classList.add('hide'); }
  $('kwGo').disabled = false; $('kwGo').textContent = 'Show keywords';
};

function renderKeywords(d) {
  const arr = firstArrayOfObjects(d, 0) || [];
  $('kwResult').classList.remove('hide');
  const sel = $('kwNiche').options[$('kwNiche').selectedIndex];
  $('kwHead').textContent = sel ? sel.textContent : 'Keywords';
  if (!arr.length) { $('kwSub').textContent = 'No keyword rows found — click “Show raw fields”.'; $('kwRows').innerHTML = ''; return; }

  const it = arr[0];
  const kKey = pickKey(it, [/^keyword$/i, /keyword.?(phrase|text)/i, /keyword/i, /phrase/i, /search.?term/i, /^term$/i]);
  const vKey = pickKey(it, [/search.?volume/i, /monthly.?search/i, /^volume$/i, /^sv$/i, /searches/i]);
  const rKey = pickKey(it, [/organic.?rank/i, /^rank$/i, /position/i]);
  $('kwSub').innerHTML = `${arr.length} keywords &nbsp;·&nbsp; mapped: keyword=<b>${kKey || '?'}</b>, volume=<b>${vKey || '?'}</b>, rank=<b>${rKey || '?'}</b>`;

  const rows = arr.slice().sort((a, b) => (num(b[vKey]) || 0) - (num(a[vKey]) || 0));
  const dash = '<span class="muted">—</span>';
  $('kwRows').innerHTML = rows.map(r => {
    const rank = rKey ? num(r[rKey]) : null;
    const page = rank && rank > 0 ? Math.ceil(rank / 48) : null;   // ~48 organic results per page (derived)
    return `<tr>
      <td>${kKey ? (r[kKey] ?? dash) : dash}</td>
      <td style="text-align:right">${vKey && num(r[vKey]) != null ? num(r[vKey]).toLocaleString('en-US') : dash}</td>
      <td style="text-align:right">${rank != null ? rank : dash}</td>
      <td style="text-align:right">${page != null ? page : dash}</td>
    </tr>`;
  }).join('');
}
$('kwRawBtn').onclick = () => {
  const raw = $('kwRaw');
  raw.classList.toggle('hide');
  if (!raw.classList.contains('hide')) {
    const arr = firstArrayOfObjects(KW_RAW, 0) || [];
    raw.textContent = 'First keyword row:\n' + JSON.stringify(arr[0] || KW_RAW, null, 2).slice(0, 4000);
  }
};

