/* STOP SERVING (Ravi, 3 Nov: "it must never cost even one cent"). Sets her search function's own door to "internal only":
 * Google then turns every outside request away BEFORE it reaches the function — such requests are not billed (Cloud Run:
 * "requests denied … are not billed"; nothing runs). Used by the function itself when her meter says stop, and by the cent
 * alarm. It changes ONLY the function meeraSearch — never billing, never another service. Undo: deploy it again (the
 * Firebase tool sets the door back to "all"). Uses the function's own Google sign-in (the metadata server). */
const SERVICE = 'projects/price-research-48ff3/locations/asia-south1/services/meerasearch';
let done = false;
export async function stopServing(fetcher = fetch) {
  if (done) return { ok: true, already: true };
  try {
    const t = await fetcher('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    if (!t.ok) return { ok: false, why: 'token ' + t.status };
    const { access_token: tok } = await t.json();
    const r = await fetcher(`https://run.googleapis.com/v2/${SERVICE}?update_mask=ingress`, { method: 'PATCH',
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY' }) });
    done = r.ok;
    return { ok: r.ok, why: r.ok ? '' : 'run ' + r.status };
  } catch (e) { return { ok: false, why: 'unreachable' }; }
}
export function resetStop() { done = false; }   // tests only
