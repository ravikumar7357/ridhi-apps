/* Settings and secrets. The names are the SAME as Apps Script's Script Properties (Pricing-API), so a value can be
 * copied one for one into Firebase's Secret Manager. A value of "none" means "not used here". */

export type Env = (name: string) => string;

/** Secrets the deployed function asks Firebase for. Every one must exist at deploy time (set "none" if unused). */
export const SECRET_NAMES = [
  'API_KEY',                                              // the shared key the pages send today (Firestore config/api)
  'SUPABASE_SERVICE_KEY',                                 // already in Secret Manager (rone-capture, sellora-live)
  'SP_CLIENT_ID', 'SP_CLIENT_SECRET', 'SP_REFRESH_TOKEN', // Ridhi SP-API (already there for sellora-live)
  'CPC_CLIENT_ID', 'CPC_CLIENT_SECRET', 'CPC_REFRESH_TOKEN',
  // Amazon Ads is a DIFFERENT API with its own login: the SP-API app is not authorised for advertising. Both brands
  // may legitimately hold the same three values (one Ads login covering both accounts) — what tells them apart is
  // then the profile, which is why ?ads=profiles is the first Ads route.
  'SP_ADS_CLIENT_ID', 'SP_ADS_CLIENT_SECRET', 'SP_ADS_REFRESH_TOKEN',
  'CPC_ADS_CLIENT_ID', 'CPC_ADS_CLIENT_SECRET', 'CPC_ADS_REFRESH_TOKEN',
  // Which Ads profile each brand's PPC is scoped to (Script Properties SP_ADS_PROFILE_ID / CPC_ADS_PROFILE_ID).
  // Not secret, but kept beside the logins so one place holds every Ads setting; "none" until it is known.
  'SP_ADS_PROFILE_ID', 'CPC_ADS_PROFILE_ID',
] as const;

export const SUPABASE_URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co';

/** Read process.env, treating "none", "-" and "n/a" as empty. */
export const processEnv: Env = (n) => {
  const v = String(process.env[n] || '').trim();
  return /^(none|-|n\/a)$/i.test(v) ? '' : v;
};

export type Brand = 'SP' | 'CPC';

/** Same rule as Apps Script setBrand_: 'CPC' → CPC, anything else → SP (Ridhi). */
export function brandOf(b: unknown): Brand {
  return String(b || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP';
}
