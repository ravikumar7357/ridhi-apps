/* ================= CORE · BACKEND: the message line, and one Amazon lookup through the backend =================
 * Screens: By Amazon Link (its message line, msg — also where sign-in's config errors are written) and New
 * Product, which calls the lookup.
 * Does: showMsg writes one line into that message slot, grey or red. callApi asks the backend at API.url,
 * with its key, about one ASIN or Amazon URL and returns the JSON it answers with.
 * Main functions: showMsg, callApi. */

/* ---------- backend call ---------- */
// Write one line into the message slot (#msg, on the By Amazon Link screen): grey normally, red when bad is true.
function showMsg(text, bad) {
  const el = $('msg');
  el.textContent = text;
  el.className = bad ? 'err' : 'muted';
}

/** One Amazon lookup through the backend. Throws on any failure (incl. `ok:false` in the payload). */
async function callApi(asinOrUrl, priceOverride) {
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  const url = new URL(API.url);
  url.searchParams.set('key', API.key);
  url.searchParams.set('asin', asinOrUrl);
  if (priceOverride > 0) url.searchParams.set('price', priceOverride);
  const res = await fetch(url, { redirect: 'follow' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Lookup failed');
  return data;
}

