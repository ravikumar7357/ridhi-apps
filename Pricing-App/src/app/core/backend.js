/* ---------- backend call ---------- */
function showMsg(t, bad) { const m = $('msg'); m.textContent = t; m.className = bad ? 'err' : 'muted'; }

/** One Amazon lookup through the backend. Throws on any failure (incl. `ok:false` in the payload). */
async function callApi(asinOrUrl, priceOverride) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const u = new URL(API.url);
  u.searchParams.set('key', API.key);
  u.searchParams.set('asin', asinOrUrl);
  if (priceOverride > 0) u.searchParams.set('price', priceOverride);
  const r = await fetch(u, { redirect: 'follow' });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'Lookup failed');
  return d;
}

