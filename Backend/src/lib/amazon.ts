/* Amazon SP-API basics, ported from Pricing-API/SpApi.gs: the login token (cached ~50 min like Apps Script's
 * CacheService), the marketplace and the regional host. One brand at a time, chosen per call (no global
 * ACTIVE_PREFIX: two requests for different brands can run at once here). */

import { callJson } from './http.ts';
import type { Brand, Env } from './env.ts';

export const LWA_URL = 'https://api.amazon.com/auth/o2/token';

export function marketplaceId(env: Env, brand: Brand): string {
  return env(brand + '_MARKETPLACE_ID') || 'ATVPDKIKX0DER';
}

export function spHost(env: Env, brand: Brand): string {
  const r = (env(brand + '_REGION') || 'na').toLowerCase();
  if (r === 'eu') return 'https://sellingpartnerapi-eu.amazon.com';
  if (r === 'fe') return 'https://sellingpartnerapi-fe.amazon.com';
  return 'https://sellingpartnerapi-na.amazon.com';
}

const tokens = new Map<string, { token: string; until: number }>();

/** Throws if the brand's credentials are missing or wrong, like getToken_. */
export async function spToken(env: Env, brand: Brand, now = Date.now()): Promise<string> {
  const hit = tokens.get(brand);
  if (hit && hit.until > now) return hit.token;
  const id = env(brand + '_CLIENT_ID'), secret = env(brand + '_CLIENT_SECRET'), refresh = env(brand + '_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error(brand + ' credentials missing in Script Properties.');
  const body = await callJson<{ access_token?: string }>('Amazon login (' + brand + ')', LWA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret }).toString(),
  });
  if (!body || !body.access_token) throw new Error('LWA token failed: no access_token in the answer');
  tokens.set(brand, { token: body.access_token, until: now + 3000 * 1000 });
  return body.access_token;
}

/* ===================== Amazon Ads ===================== */
/* A DIFFERENT API from SP-API, with its own credentials (AdsApi.gs). Ported from adsHost_ / adsClientId_ / adsToken_.
 * Both brands may share one Ads login; the PROFILE is what separates them. */

const ADS_HOSTS: Record<string, string> = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
};

/** adsHost_: the brand's Ads region, else its SP-API region, else NA — an advertising account lives in the same
 *  region as the selling account in every setup here. */
export function adsHost(env: Env, brand: Brand): string {
  const r = (env(brand + '_ADS_REGION') || env(brand + '_REGION') || 'na').toLowerCase();
  return ADS_HOSTS[r] || ADS_HOSTS.na;
}

export function adsClientId(env: Env, brand: Brand): string {
  return env(brand + '_ADS_CLIENT_ID');
}

const adsTokens = new Map<string, { token: string; until: number }>();

/** adsToken_: access token for the brand's advertising account. Cached 50 minutes (they last 60), as in Apps Script. */
export async function adsToken(env: Env, brand: Brand, now = Date.now()): Promise<string> {
  const hit = adsTokens.get(brand);
  if (hit && hit.until > now) return hit.token;
  const id = env(brand + '_ADS_CLIENT_ID'), secret = env(brand + '_ADS_CLIENT_SECRET'), refresh = env(brand + '_ADS_REFRESH_TOKEN');
  if (!id || !secret || !refresh) {
    throw new Error('Missing Script Properties: ' + brand + '_ADS_CLIENT_ID / ' + brand + '_ADS_CLIENT_SECRET / ' + brand + '_ADS_REFRESH_TOKEN');
  }
  const body = await callJson<{ access_token?: string }>('Amazon Ads login (' + brand + ')', LWA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret }).toString(),
  });
  if (!body || !body.access_token) throw new Error('Ads LWA token failed: no access_token in the answer');
  adsTokens.set(brand, { token: body.access_token, until: now + 3000 * 1000 });
  return body.access_token;
}

/** Tests only: forget cached tokens. */
export function clearTokenCache(): void { tokens.clear(); adsTokens.clear(); }
