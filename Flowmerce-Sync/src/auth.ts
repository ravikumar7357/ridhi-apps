/* Logging in to a store as the Flowmerce Shopify app.
 *
 * A Dev Dashboard app installed on stores of its own organisation can swap its client ID + secret for a store token
 * (client-credentials grant): POST https://{shop}.myshopify.com/admin/oauth/access_token. The token lasts about 24 h;
 * it is kept in memory only (never in a table, never logged) and fetched again 10 minutes before it runs out.
 * If the app cannot log in (not installed yet, wrong secret), Sellora's store token is used instead and the reason
 * is returned, so the job keeps running and the log says why. */

import type { AppCred, ShopCred, StoreBase } from './config.ts';

interface Cached { token: string; expiresAt: number }
const cache = new Map<string, Cached>();
export function clearTokenCache() { cache.clear(); }

export async function appToken(host: string, app: AppCred, now = Date.now()): Promise<string> {
  const key = host + '|' + app.clientId;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 10 * 60_000 > now) return hit.token;
  const r = await fetch(`https://${host}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: app.clientId, client_secret: app.clientSecret }).toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`app login refused by ${host} (${r.status}): ${text.slice(0, 200)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`app login: ${host} did not answer JSON`); }
  if (!j.access_token) throw new Error(`app login: ${host} sent no access_token`);
  const ttl = Number(j.expires_in) > 0 ? Number(j.expires_in) * 1000 : 23 * 3600_000;
  cache.set(key, { token: j.access_token, expiresAt: now + ttl });
  return j.access_token;
}

export interface Resolved { cred: ShopCred | null; note?: string }

/** The token to use for one store: the app's if it can log in, otherwise the store token. */
export async function resolveCred(base: StoreBase, app: AppCred | null): Promise<Resolved> {
  let note: string | undefined;
  if (app) {
    try {
      const token = await appToken(base.host, app);
      return { cred: { code: base.code, host: base.host, token, via: 'app', webhookSecrets: base.webhookSecrets } };
    } catch (e) {
      note = String((e as Error).message || e);
    }
  }
  if (base.storeToken) {
    return { cred: { code: base.code, host: base.host, token: base.storeToken, via: 'store_token', webhookSecrets: base.webhookSecrets },
             note: note ? `using the store token: ${note}` : undefined };
  }
  return { cred: null, note: note || 'no app login and no store token' };
}
