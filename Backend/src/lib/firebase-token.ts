/* Checking a Firebase sign-in without the Firebase packages, so the backend can run anywhere (this PC, a plain
 * server) and still know who is calling. It does what firebase-admin's verifyIdToken does for an ID token:
 *
 *   signed by Google (RS256, one of Google's current public keys, picked by "kid")
 *   for our project (aud = project id, iss = https://securetoken.google.com/<project id>)
 *   not expired, not issued in the future, for a real user (sub set)
 *
 * Anything that fails any check is "not signed in" (null), never an error page. Google's keys are fetched once an
 * hour. Revoked sessions are not checked (firebase-admin doesn't either unless asked). */

import { createPublicKey, createVerify, type JsonWebKey as NodeJwk, type KeyObject } from 'node:crypto';

export const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cache: { keys: Map<string, KeyObject>; until: number } | null = null;

/** Google's public keys for Firebase sign-in, by key id. */
export async function googleKeys(now = Date.now()): Promise<Map<string, KeyObject>> {
  if (cache && cache.until > now) return cache.keys;
  const r = await fetch(GOOGLE_JWK_URL);
  if (!r.ok) throw new Error('Google sign-in keys ' + r.status);
  const body = await r.json() as { keys?: (NodeJwk & { kid?: string })[] };
  const keys = new Map<string, KeyObject>();
  for (const k of body.keys || []) if (k.kid) keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
  cache = { keys, until: now + 3_600_000 };
  return keys;
}

/** Tests only. */
export function clearKeyCache(): void { cache = null; }

const part = (s: string) => Buffer.from(s, 'base64url');

export interface VerifyOpts {
  now?: () => number;
  keys?: () => Promise<Map<string, KeyObject>>;
}

/** The signed-in person's email, or null if the token is not a valid sign-in for this project. */
export async function verifyFirebaseIdToken(token: string, projectId: string, o: VerifyOpts = {}): Promise<string | null> {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || !projectId) return null;
    const header = JSON.parse(part(parts[0]).toString('utf8'));
    const p = JSON.parse(part(parts[1]).toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const now = Math.floor((o.now ? o.now() : Date.now()) / 1000);
    if (p.aud !== projectId || p.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof p.sub !== 'string' || !p.sub) return null;
    if (!(Number(p.exp) > now)) return null;                       // expired
    if (!(Number(p.iat) <= now + 300)) return null;                // issued in the future (5 min of clock slack)
    if (p.auth_time !== undefined && !(Number(p.auth_time) <= now + 300)) return null;

    const keys = await (o.keys ? o.keys() : googleKeys());
    const key = keys.get(header.kid);
    if (!key) return null;
    const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(key, part(parts[2]));
    if (!ok) return null;
    return typeof p.email === 'string' && p.email ? p.email : null;
  } catch {
    return null;
  }
}
