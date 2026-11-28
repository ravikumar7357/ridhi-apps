/* THE ERP DOOR: the one place an ERP page's saves and reads go through, instead of the page calling Supabase itself.
 *
 *   POST /erp/save   body (JSON as text): { idToken, changes: [{k,p,v,t}...], screen? }   →  { ok, saved }
 *   POST /erp/read   body (JSON as text): { idToken, path, orderBy?, equalTo?, limitLast? } →  { ok, value }
 *
 * Step 1 (now): the server checks the Firebase sign-in itself, then asks the database AS THAT PERSON (their token is
 * passed on), so the database's own rights checks and the "who saved" email keep working exactly as today.
 * Later: the rules move into this file and the server talks to the database with its own key; then the database is
 * closed to browsers. Nothing here changes the ERP until a page is switched to send through the door (layer.js). */

export const ERP_SUPABASE_URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co';
/** The publishable key: made for browsers, not a secret (it is in every ERP page today). */
export const ERP_PUBLISHABLE_KEY = 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q';

export interface DoorDeps {
  verifyIdToken: (token: string) => Promise<string | null>;
  fetch?: typeof fetch;
  url?: string;
  log?: (line: object) => void;
  now?: () => number;
}

type Out = { ok: true; [k: string]: unknown } | { ok: false; error: string };

async function asPerson(d: DoorDeps, token: string, fn: string, args: object): Promise<unknown> {
  const f = d.fetch || fetch;
  const r = await f(`${d.url || ERP_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ERP_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      'Content-Profile': 'core', 'Accept-Profile': 'core' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* plain text */ }
    throw new Error(String(msg || `database ${r.status}`).slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

/** Handle one door request. Never throws. */
export async function erpDoor(d: DoorDeps, action: string, rawBody: string): Promise<Out> {
  const now = d.now || Date.now;
  const t0 = now();
  let p: any;
  try { p = JSON.parse(rawBody || '{}'); } catch { return { ok: false, error: 'Body was not JSON.' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'Body was not JSON.' };

  const token = String(p.idToken || '');
  const email = token ? await d.verifyIdToken(token).catch(() => null) : null;
  if (!email) return { ok: false, error: 'Sign in again — the server could not confirm who you are.' };

  try {
    let out: Out;
    if (action === 'save') {
      if (!Array.isArray(p.changes) || !p.changes.length) return { ok: false, error: 'Nothing to save (changes must be a list).' };
      const saved = await asPerson(d, token, 'rt_save', { p_changes: p.changes, p_screen: p.screen ? String(p.screen).slice(0, 60) : null });
      out = { ok: true, saved };
    } else if (action === 'read') {
      if (typeof p.path !== 'string' || !p.path.trim()) return { ok: false, error: 'Which list? (path is missing)' };
      const value = await asPerson(d, token, 'rt_get', {
        p_path: p.path, p_order_by: p.orderBy ?? null, p_equal_to: p.equalTo ?? null, p_limit_last: p.limitLast ?? null,
      });
      out = { ok: true, value };
    } else {
      return { ok: false, error: `The door has no "${action}".` };
    }
    d.log?.({ door: action, who: email, ok: true, ms: now() - t0, n: action === 'save' ? p.changes.length : undefined });
    return out;
  } catch (e) {
    const error = String((e as Error)?.message || e).slice(0, 300);
    d.log?.({ door: action, who: email, ok: false, ms: now() - t0, error });
    return { ok: false, error };
  }
}
