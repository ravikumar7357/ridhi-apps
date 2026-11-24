/* What the backend needs, by name. Secrets live in Firebase Secret Manager (firebase functions:secrets:set NAME) and
 * reach the code as environment variables — never in the code, never in GitHub.
 * The Shopify and Supabase secrets are the SAME ones Sellora-Backend already uses (same Firebase project). */

export const STORES = ['RBP', 'CPC'] as const;
export type StoreCode = typeof STORES[number];

export const SECRET_NAMES = [
  'SUPABASE_SERVICE_KEY',                              // shared with sellora-live and rone-capture
  'SHOPIFY_STORE', 'SHOPIFY_TOKEN',                    // Ridhi (RBP) — Sellora's names, no prefix
  'CPC_SHOPIFY_STORE', 'CPC_SHOPIFY_TOKEN',            // Cotton Print Club
  'SHOPIFY_WEBHOOK_SECRET_RBP', 'SHOPIFY_WEBHOOK_SECRET_CPC',   // NEW: each store's webhook signing key
] as const;

/** The ERP data project (Mumbai). SUPABASE_URL in the environment points the backend at a test project instead. */
export const SUPABASE_URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co';
export const SHOPIFY_API_VERSION = '2025-10';

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

export interface ShopCred { code: StoreCode; host: string; token: string; webhookSecret: string }

export function shopCred(env: Env, code: StoreCode): ShopCred | null {
  const p = code === 'CPC' ? 'CPC_' : '';
  const host = storeHost(env(p + 'SHOPIFY_STORE'));
  const token = env(p + 'SHOPIFY_TOKEN');
  if (!host || !token) return null;
  if (token.startsWith('shpss_')) throw new Error(`${code}: the Shopify token is the app's SECRET (shpss_…), not an Admin API access token (shpat_…)`);
  return { code, host, token, webhookSecret: env('SHOPIFY_WEBHOOK_SECRET_' + code) };
}
