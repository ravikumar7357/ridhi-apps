/* The front door as a plain Node web server, for running the backend outside Google (this PC, DigitalOcean).
 * The same router answers as on Google, so pages see no difference:
 *
 *   /  or /api   the Apps Script routes (src/routes)
 *   /save        saves that must reach an outside service (src/saves)
 *   /erp/action/rfd-challan   make an RFD challan in one step (src/erp/actions)
 *   /erp/save, /erp/read   the ERP door (src/erp/door.ts): sign-in checked here, then the database
 *   /health      is it up, and how is the queue doing (no key needed; says nothing private)
 *
 * GET parameters come from the query string (first value of each); POST bodies are text, at most 1 MB. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handle, type Answer, type Deps, type Route } from './router.ts';
import { erpDoor, type DoorDeps } from '../erp/door.ts';
import { RepeatGuard } from '../erp/actions/rfd-challan.ts';
import { readFile } from 'node:fs/promises';

export interface ServerDeps extends Omit<Deps, 'routes'> {
  apiRoutes: Route[];
  saveRoutes: Route[];
  /** Extra facts for /health: queue counts, timers running. */
  health?: () => object;
  /** Tests only: stands in for the database behind the ERP door. */
  erpFetch?: typeof fetch;
  /** The ERP rules' look at ERP data (server key). Without it the door saves with no rule notes. */
  erpRules?: DoorDeps['rules'];
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const MAX_BODY = 1_000_000;
const MAX_ERP_BODY = 8_000_000;   // the same cap the database puts on one save

function send(res: ServerResponse, a: Answer): void {
  res.writeHead(a.status, a.headers);
  res.end(a.body);
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new TooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function requestHandler(d: ServerDeps) {
  const repeat = new RepeatGuard();   // one per running server: a repeated action request writes nothing twice
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/health') {
        send(res, { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, ...(d.health ? d.health() : {}) }) });
        return;
      }
      if (path === '/erp/try' && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')) {
        // a test page for the door, answered only to this same computer (never on the Droplet's public address)
        const html = await readFile(new URL('../../tools/erp-door-try.html', import.meta.url), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
      }
      const door = path.match(/^\/erp\/(save|read|action\/rfd-challan|action\/receive-challan|action\/approve-sales-order|action\/approve-vendor-order)$/);
      if (door) {
        if (req.method === 'OPTIONS') { send(res, { status: 204, headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' }); return; }
        if (req.method !== 'POST' || !d.verifyIdToken) { send(res, { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'The ERP door takes POST only.' }) }); return; }
        const raw = await readBody(req, MAX_ERP_BODY);
        const out = await erpDoor({ verifyIdToken: d.verifyIdToken, rules: d.erpRules, repeat, log: d.log, now: d.now, fetch: d.erpFetch }, door[1], raw);
        send(res, { status: 200, headers: JSON_HEADERS, body: JSON.stringify(out) });
        return;
      }
      const routes = path === '/'|| path === '/api' ? d.apiRoutes : path === '/save' ? d.saveRoutes : null;
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
