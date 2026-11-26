/* The front door as a plain Node web server, for running the backend outside Google (this PC, DigitalOcean).
 * The same router answers as on Google, so pages see no difference:
 *
 *   /  or /api   the Apps Script routes (src/routes)
 *   /save        saves that must reach an outside service (src/saves)
 *   /health      is it up, and how is the queue doing (no key needed; says nothing private)
 *
 * GET parameters come from the query string (first value of each); POST bodies are text, at most 1 MB. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handle, type Answer, type Deps, type Route } from './router.ts';

export interface ServerDeps extends Omit<Deps, 'routes'> {
  apiRoutes: Route[];
  saveRoutes: Route[];
  /** Extra facts for /health: queue counts, timers running. */
  health?: () => object;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const MAX_BODY = 1_000_000;

function send(res: ServerResponse, a: Answer): void {
  res.writeHead(a.status, a.headers);
  res.end(a.body);
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new TooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function requestHandler(d: ServerDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/health') {
        send(res, { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, ...(d.health ? d.health() : {}) }) });
        return;
      }
      const routes = path === '/' || path === '/api' ? d.apiRoutes : path === '/save' ? d.saveRoutes : null;
      if (!routes) {
        send(res, { status: 404, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'Not found.' }) });
        return;
      }
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => { if (!(k in query)) query[k] = v; });
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const deps: Deps = { env: d.env, db: d.db, routes, verifyIdToken: d.verifyIdToken, gateway: d.gateway, now: d.now, log: d.log };
      send(res, await handle(deps, req.method || 'GET', query, raw));
    } catch (e) {
      const big = e instanceof TooLarge;
      if (!res.headersSent) send(res, { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: big ? 'Body too large.' : 'Server error.' }) });
    }
  };
}

/** Start listening; answers the running server (port 0 = any free port, for tests). */
export function startServer(d: ServerDeps, port: number, host: string): Promise<Server> {
  const s = createServer(requestHandler(d));
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, host, () => resolve(s));
  });
}
