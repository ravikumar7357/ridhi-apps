/* What the backend needs, by name. The names are the SAME as Apps Script's Script Properties, so the values can be copied
 * across one for one. On Firebase they live in Secret Manager (firebase functions:secrets:set NAME) and reach the code as
 * environment variables — never in the code, never in GitHub. */

import type { LwaCred } from './amazon.ts';

export const BRANDS = ['SP', 'CPC'] as const;
export type Brand = typeof BRANDS[number];

/** Every secret the scheduled function is given. A Meta value that does not apply can be set to "none". */
export const SECRET_NAMES = [
  'SUPABASE_SERVICE_KEY',                                   // shared with the rone-capture functions
  'SP_CLIENT_ID', 'SP_CLIENT_SECRET', 'SP_REFRESH_TOKEN',
  'CPC_CLIENT_ID', 'CPC_CLIENT_SECRET', 'CPC_REFRESH_TOKEN',
  // No *_ADS_PROFILE_ID here (21 Nov): the profile is found by itself, as Apps Script does, and an empty secret stops the
  // deploy. To pin one anyway, set SP_ADS_PROFILE_ID / CPC_ADS_PROFILE_ID as plain environment variables.
  'SP_ADS_CLIENT_ID', 'SP_ADS_CLIENT_SECRET', 'SP_ADS_REFRESH_TOKEN',
  'CPC_ADS_CLIENT_ID', 'CPC_ADS_CLIENT_SECRET', 'CPC_ADS_REFRESH_TOKEN',
  'SHOPIFY_STORE', 'SHOPIFY_TOKEN', 'CPC_SHOPIFY_STORE', 'CPC_SHOPIFY_TOKEN',
  'META_TOKEN', 'META_AD_ACCOUNT', 'CPC_META_TOKEN', 'CPC_META_AD_ACCOUNT',
] as const;

/** The ERP data project (Mumbai). Not a secret; SUPABASE_URL in the environment points the backend elsewhere (a test project). */
export const SUPABASE_URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co';

export type Env = (name: string) => string;

/** Read from the environment; "none", "-" and blanks count as not set. */
export const processEnv: Env = name => {
  const v = String(process.env[name] || '').trim();
  return /^(none|-|n\/a)$/i.test(v) ? '' : v;
};

export interface BrandConfig {
  brand: Brand;
  sales: LwaCred | null;
  ads: (LwaCred & { profileId: string }) | null;
  shop: { store: string; token: string } | null;
  meta: { token: string; account: string } | null;
}

export function brandConfig(env: Env, brand: Brand): BrandConfig {
  const p = brand + '_';                                    // Amazon: SP_… / CPC_…
  const s = brand === 'CPC' ? 'CPC_' : '';                  // Shopify and Meta: Ridhi has no prefix
  const lwa = (id: string, sec: string, ref: string): LwaCred | null =>
    env(id) && env(sec) && env(ref) ? { clientId: env(id), clientSecret: env(sec), refreshToken: env(ref) } : null;
  const sales = lwa(p + 'CLIENT_ID', p + 'CLIENT_SECRET', p + 'REFRESH_TOKEN');
  const adsCred = lwa(p + 'ADS_CLIENT_ID', p + 'ADS_CLIENT_SECRET', p + 'ADS_REFRESH_TOKEN');
  return {
    brand, sales,
    ads: adsCred ? { ...adsCred, profileId: env(p + 'ADS_PROFILE_ID') } : null,
    shop: env(s + 'SHOPIFY_STORE') && env(s + 'SHOPIFY_TOKEN') ? { store: env(s + 'SHOPIFY_STORE'), token: env(s + 'SHOPIFY_TOKEN') } : null,
    // Each brand its own Meta token (Ravi, 21 Nov: one for Ridhi, one for CPC); a brand without one uses Ridhi's.
    meta: (env(s + 'META_TOKEN') || env('META_TOKEN')) && env(s + 'META_AD_ACCOUNT')
      ? { token: env(s + 'META_TOKEN') || env('META_TOKEN'), account: env(s + 'META_AD_ACCOUNT') } : null,
  };
}
