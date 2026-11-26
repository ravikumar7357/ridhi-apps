/* One way to call the outside world (same as Sellora-Backend/src/http.ts): retries on rate limits (429) and server
 * hiccups (5xx, network), honours Retry-After, and an error that says which service answered what. Uses the global
 * fetch, so tests can stand in for every service. */

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(what: string, status: number, body: string) {
    super(`${what} ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function call(what: string, url: string, init: RequestInit = {}, tries = 4, waitMs = 1500): Promise<Response> {
  let last: unknown = null;
  for (let a = 0; a < tries; a++) {
    let r: Response;
    try { r = await fetch(url, init); }
    catch (e) { last = e; await sleep(waitMs * (a + 1)); continue; }          // network: try again
    if (r.status === 429 || r.status >= 500) {
      last = new HttpError(what, r.status, await r.text().catch(() => ''));
      const ra = Number(r.headers.get('retry-after'));
      await sleep(ra > 0 && ra < 30 ? ra * 1000 : waitMs * (a + 1));
      continue;
    }
    if (!r.ok) throw new HttpError(what, r.status, await r.text().catch(() => ''));
    return r;
  }
  throw last instanceof Error ? last : new Error(`${what}: gave up after ${tries} tries`);
}

export async function callJson<T = any>(what: string, url: string, init: RequestInit = {}, tries?: number, waitMs?: number): Promise<T> {
  const r = await call(what, url, init, tries, waitMs);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}
