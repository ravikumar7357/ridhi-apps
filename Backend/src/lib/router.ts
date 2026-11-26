/* The front door. It speaks EXACTLY like Apps Script's doGet/doPost (Pricing-API/Code.gs), so a page can be pointed at
 * this backend one route at a time with no other change:
 *
 *   GET  ?key=…&<route>=…&…            parameters in the query string
 *   POST body = JSON sent as text/plain  (keeps it a "simple request": no CORS preflight), key inside the body
 *   answer: always HTTP 200 + JSON with ok: true/false, errors cut to 300 characters — like json_() in Apps Script
 *
 * A route is found by its "discriminator": the parameter that names it, and the value when that parameter has several
 * (ads=ppcCreate vs ads=ppcStatus). Routes that have not moved here yet answer ok:false and say so, so a page that
 * was switched too early fails loudly instead of quietly getting something else. */

import { timingSafeEqual } from 'node:crypto';
import type { Env } from './env.ts';
import type { DbLike } from './db.ts';
import type { AmazonGateway } from './gateway.ts';

export type Params = Record<string, any>;

export interface Ctx {
  env: Env;
  db: DbLike;
  method: 'GET' | 'POST';
  /** The signed-in person, when the route asks for it (from the Firebase ID token the page sends as idToken). */
  who?: { email: string } | null;
  now: () => number;
  /** The one way to call Amazon, for the routes that do. Asked for only when a route needs it, because building it
   *  reads the switches from Supabase. A route calls amazonGateway(ctx) rather than this directly. */
  gateway?: () => Promise<AmazonGateway>;
}

/** The gateway, or a plain refusal if this backend was started without one. */
export async function amazonGateway(ctx: Ctx): Promise<AmazonGateway> {
  if (!ctx.gateway) throw new Error('This backend cannot call Amazon: no gateway was set up.');
  return ctx.gateway();
}

export interface Route {
  /** e.g. "ping", "ads:ppcCreate", "mcf:create" — also the name used in the parity tool and in ROUTES.md */
  name: string;
  method: 'GET' | 'POST';
  /** The parameter that names the route, and its value if the parameter is shared (omit = any non-empty value). */
  param: string;
  value?: string;
  /** 'key' = the shared API key, like Apps Script today. 'signin' = the key AND a valid signed-in person. */
  auth: 'key' | 'signin';
  run(p: Params, ctx: Ctx): Promise<object>;
}

export interface Deps {
  env: Env;
  db: DbLike;
  routes: Route[];
  /** Check a Firebase ID token and return the person's email, or null. Injected so tests need no Firebase. */
  verifyIdToken?: (token: string) => Promise<string | null>;
  /** Built on demand (it reads the switches), so a route that never calls Amazon costs nothing. */
  gateway?: () => Promise<AmazonGateway>;
  now?: () => number;
  log?: (line: object) => void;
}

export interface Answer { status: number; headers: Record<string, string>; body: string }

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const answer = (o: object): Answer => ({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(o) });
const fail = (error: string): Answer => answer({ ok: false, error: error.slice(0, 300) });

function sameKey(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function findRoute(routes: Route[], method: 'GET' | 'POST', p: Params): Route | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const v = p[r.param];
    if (v === undefined || v === null || v === '') continue;
    if (r.value === undefined || String(v) === r.value) return r;
  }
  return null;
}

/** Names the route a request is asking for, even when it hasn't moved here: "ads:ppcStatus", "asin", … */
export function askedFor(p: Params): string {
  const skip = new Set(['key', 'idToken', 'brand', 'days', 'start', 'end', 'id', 'n', 'book', 'shop']);
  const k = Object.keys(p).find(x => !skip.has(x));
  if (!k) return '(none)';
  const v = p[k];
  return typeof v === 'string' && /^[a-zA-Z]{2,20}$/.test(v) && !/^\d/.test(v) ? `${k}:${v}` : k;
}

/** Handle one request. Never throws: every outcome is an Apps-Script-shaped JSON answer. */
export async function handle(deps: Deps, method: string, query: Params, rawBody: string): Promise<Answer> {
  const now = deps.now || Date.now;
  const t0 = now();
  if (method === 'OPTIONS') {
    return { status: 204, headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (method !== 'GET' && method !== 'POST') return fail('Only GET and POST are answered here.');

  let p: Params = query || {};
  if (method === 'POST') {
    try { p = JSON.parse(rawBody || '{}'); } catch { return fail('Body was not JSON.'); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return fail('Body was not JSON.');
  }

  const key = deps.env('API_KEY');
  if (!key) return fail('API_KEY is not set on the backend.');
  const sent = String(p.key || '').trim();
  if (!sameKey(sent, key)) {
    return fail('Unauthorized.' + (method === 'GET' ? (sent ? ` (sent a ${sent.length}-char key; backend expects ${key.length})` : ' (no key sent)') : ''));
  }

  const route = findRoute(deps.routes, method, p);
  const name = route ? route.name : askedFor(p);
  if (!route) {
    deps.log?.({ route: name, method, ok: false, ms: now() - t0, note: 'not moved' });
    return fail(`This request (${name}) has not moved to the new backend yet. Send it to Apps Script.`);
  }

  let who: { email: string } | null = null;
  if (route.auth === 'signin') {
    const email = p.idToken && deps.verifyIdToken ? await deps.verifyIdToken(String(p.idToken)).catch(() => null) : null;
    if (!email) return fail('Sign in again — the backend could not confirm who you are.');
    who = { email };
  }
  delete p.key;
  delete p.idToken;

  try {
    const out = await route.run(p, { env: deps.env, db: deps.db, method, who, now, gateway: deps.gateway });
    deps.log?.({ route: name, method, ok: (out as any).ok !== false, ms: now() - t0, who: who?.email });
    return answer(out);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    deps.log?.({ route: name, method, ok: false, ms: now() - t0, error: msg.slice(0, 300) });
    return fail(msg);
  }
}
