/* WHO IS ASKING: every question carries the ERP's own Firebase sign-in (an ID token). It is checked here against Google's
 * public keys — signed by Google, for this project, not expired — so the router answers the ERP's people and nobody else.
 * No password, no new login: the token the ERP already has. */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let KEYS = { at: 0, keys: null };

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const json = s => JSON.parse(new TextDecoder().decode(b64u(s)));

async function keys(fetcher) {
  if (KEYS.keys && Date.now() - KEYS.at < 3600e3) return KEYS.keys;
  const r = await fetcher(JWKS_URL);
  if (!r.ok) throw new Error('google keys ' + r.status);
  KEYS = { at: Date.now(), keys: (await r.json()).keys || [] };
  return KEYS.keys;
}
/** For tests: forget the cached keys. */
export function resetKeys() { KEYS = { at: 0, keys: null }; }

/** The signed-in person, or null: { uid, email, admin } (admin from ADMIN_EMAILS). */
export async function verify(token, env, fetcher = fetch) {
  try {
    const [h, p, sig] = String(token || '').split('.');
    if (!h || !p || !sig) return null;
    const head = json(h), body = json(p);
    if (head.alg !== 'RS256' || !head.kid) return null;
    const project = env.FIREBASE_PROJECT_ID;
    const now = Math.floor(Date.now() / 1000);
    if (body.aud !== project || body.iss !== 'https://securetoken.google.com/' + project) return null;
    if (!body.sub || typeof body.exp !== 'number' || body.exp < now - 30 || (body.iat || 0) > now + 300) return null;
    const jwk = (await keys(fetcher)).find(k => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
    const email = String(body.email || '').toLowerCase();
    const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    return { uid: body.sub, email, admin: !!email && admins.includes(email) };
  } catch (e) { return null; }
}
