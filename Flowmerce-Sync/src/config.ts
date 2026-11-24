/* What the backend needs, by name. Secrets live in Firebase Secret Manager (firebase functions:secrets:set NAME) and
 * reach the code as environment variables — never in the code, never in GitHub.
 *
 * Shopify access, in this order (auth.ts):
 *   1. the Flowmerce Shopify app (Dev Dashboard): FLOWMERCE_APP_CLIENT_ID + FLOWMERCE_APP_CLIENT_SECRET,
 *      exchanged for a store token (~24 h) by the client-credentials grant. One app, both stores.
 *   2. fallback: Sellora's store tokens (SHOPIFY_TOKEN / CPC_SHOPIFY_TOKEN), so nothing stops if the app cannot log in.
 * The store addresses come from Sellora's SHOPIFY_STORE / CPC_SHOPIFY_STORE. */

export const STORES = ['RBP', 'CPC'] as const;
export type StoreCode = typeof STORES[number];

export const SECRET_NAMES = [
  'SUPABASE_SERVICE_KEY',                              // shared with sellora-live and rone-capture
  'SHOPIFY_STORE', 'SHOPIFY_TOKEN',                    // Ridhi (RBP) — Sellora's names, no prefix
  'CPC_SHOPIFY_STORE', 'CPC_SHOPIFY_TOKEN',            // Cotton Print Club
  'SHOPIFY_WEBHOOK_SECRET_RBP', 'SHOPIFY_WEBHOOK_SECRET_CPC',   // each store's own webhook signing key
  'FLOWMERCE_APP_CLIENT_ID', 'FLOWMERCE_APP_CLIENT_SECRET',     // the Flowmerce Shopify app (24 Nov 2026)
] as const;

/** The ERP data project (Mumbai). SUPABASE_URL in the environment points the backend at a test project instead. */
export const SUPABASE_URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co';
export const SHOPIFY_API_VERSION = '2025-10';
/** Where Shopify sends this app's webhooks (flowmerceShopifyWebhook). WEBHOOK_URL in the environment overrides it. */
export const WEBHOOK_URL = 'https://asia-south1-price-research-48ff3.cloudfunctions.net/flowmerceShopifyWebhook';

export type Env = (name: string) => string;

/** Read from the environment; "none", "-" and blanks count as not set. */
export const processEnv: Env = name => {
  const v = String(process.env[name] || '').trim();
  return /^(none|-|n\/a)$/i.test(v) ? '' : v;
};

/** "mystore.myshopify.com" from whatever was saved (also the admin.shopify.com/store/<handle> form). */
export function storeHost(s: string): string {
  s = String(s || '').trim().replace(/^https?:\/\//, '');
  const m = s.match(/admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (m) return (m[1] + '.myshopify.com').toLowerCase();
  s = s.replace(/\/.*$/, '');
  if (!s) return '';
  return (s.includes('.myshopify.com') ? s : s + '.myshopify.com').toLowerCase();
}

export interface AppCred { clientId: string; clientSecret: string }

/** What we know about a store before logging in. */
export interface StoreBase {
  code: StoreCode;
  host: string;
  storeToken: string;          // Sellora's token — the fallback
  webhookSecrets: string[];    // every key a genuine webhook may be signed with (store key, app secret)
}

/** A store we can talk to: the token that will actually be used, and where it came from. */
export interface ShopCred {
  code: StoreCode;
  host: string;
  token: string;
  via: 'app' | 'store_token';
  webhookSecrets: string[];
}

export function appCred(env: Env): AppCred | null {
  const clientId = env('FLOWMERCE_APP_CLIENT_ID'), clientSecret = env('FLOWMERCE_APP_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function storeBase(env: Env, code: StoreCode): StoreBase | null {
  const p = code === 'CPC' ? 'CPC_' : '';
  const host = storeHost(env(p + 'SHOPIFY_STORE'));
  if (!host) return null;
  const storeToken = env(p + 'SHOPIFY_TOKEN');
  if (storeToken.startsWith('shpss_')) throw new Error(`${code}: the Shopify token is the app's SECRET (shpss_…), not an Admin API access token (shpat_…)`);
  const app = appCred(env);
  const webhookSecrets = [env('SHOPIFY_WEBHOOK_SECRET_' + code), app?.clientSecret || ''].filter(Boolean);
  return { code, host, storeToken, webhookSecrets: [...new Set(webhookSecrets)] };
}
