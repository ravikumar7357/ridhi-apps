/* R-one's backend on Firebase (project price-research-48ff3, codebase "rone-backend", region asia-south1 Mumbai).
 *
 * Three parts, each its own Cloud Run service, so each grows on its own and one can't slow another down:
 *
 *   roneApi    the Apps Script routes the pages still call (src/routes), same door as Pricing-API's web app
 *   roneSave   every ERP and Sellora save (src/saves); sign-in required on every save
 *   roneGet    takes ONE task off the queue and runs that job (src/jobs): getting from Amazon/Shopify, filling Supabase
 *   timers-*   one Cloud Scheduler timer each (src/jobs/timers.ts); a timer only puts tasks on roneGet's queue
 *
 * COST: every part starts with 0 warm copies, so nothing is billed while nothing runs. Raise roneSave's minInstances
 * to 1 (about ₹1,100 a month) on the day the first ERP screen saves through it, so a save never waits on a cold start.
 *
 * Everything here is wiring. The logic lives in lib/, routes/, saves/ and jobs/, where it is tested with every
 * outside service faked. */

import { onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFunctions } from 'firebase-admin/functions';
import { SECRET_NAMES, SUPABASE_URL, processEnv } from './lib/env.ts';
import { Db } from './lib/db.ts';
import { handle, type Route } from './lib/router.ts';
import { AmazonGateway } from './lib/gateway.ts';
import { DbLimiter } from './lib/limiter.ts';
import { loadControls } from './lib/controls.ts';
import { runTask, type Task } from './lib/tasks.ts';
import { ROUTES } from './routes/index.ts';
import { SAVE_ROUTES } from './saves/index.ts';
import { JOBS } from './jobs/index.ts';
import { TIMERS } from './jobs/timers.ts';

initializeApp();
const REGION = 'asia-south1';
const secrets = SECRET_NAMES.map(n => defineSecret(n));
/** roneGet's queue, by its full name: Cloud Tasks creates it when roneGet is first deployed. */
const QUEUE = `locations/${REGION}/functions/roneGet`;

const db = () => new Db(SUPABASE_URL, processEnv('SUPABASE_SERVICE_KEY'), 'backend');

/** A gateway that reads the switches fresh, so a switch changed in Supabase takes effect on the next request. */
const gatewayFor = (d: Db) => async () =>
  new AmazonGateway({ env: processEnv, limiter: new DbLimiter(d), controls: await loadControls(d) });

const verifyIdToken = async (t: string) => {
  try { return (await getAuth().verifyIdToken(t)).email || null; } catch { return null; }
};

/** The same front door for roneApi and roneSave; only the route list differs. */
function door(name: string, routes: Route[]) {
  return async (req: { method: string; query: unknown; body: unknown; rawBody?: Buffer },
                res: { status(n: number): { set(h: Record<string, string>): { send(b: string): void } } }) => {
    const d = db();
    const raw = typeof req.body === 'string' ? req.body : (req.rawBody ? req.rawBody.toString('utf8') : '');
    const out = await handle({
      env: processEnv, db: d, routes, verifyIdToken, gateway: gatewayFor(d),
      log: (line) => logger.info(name, line),
    }, req.method, req.query as Record<string, any>, raw);
    res.status(out.status).set(out.headers).send(out.body);
  };
}

export const roneApi = onRequest(
  { region: REGION, memory: '512MiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 10, concurrency: 40, secrets },
  door('roneApi', ROUTES),
);

export const roneSave = onRequest(
  // minInstances: 0 until the first screen saves here; then 1. maxInstances caps how hard saves can push Supabase.
  { region: REGION, memory: '1GiB', timeoutSeconds: 60, minInstances: 0, maxInstances: 20, concurrency: 40, secrets },
  door('roneSave', SAVE_ROUTES),
);

export const roneGet = onTaskDispatched<Task>(
  {
    region: REGION, memory: '1GiB', timeoutSeconds: 540, minInstances: 0, maxInstances: 10, concurrency: 1, secrets,
    // Only "wait" failures are thrown back to the queue (see lib/tasks.ts), so these retries never hammer Amazon.
    retryConfig: { maxAttempts: 5, minBackoffSeconds: 10, maxBackoffSeconds: 600, maxDoublings: 6 },
    // At most 10 tasks running at once across every copy; Amazon's own pace is kept by the gateway.
    rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 5 },
  },
  async (req) => {
    const d = db();
    const r = await runTask(req.data, { jobs: JOBS, env: processEnv, db: d, gateway: gatewayFor(d) });
    logger.info('roneGet', { job: r.job, outcome: r.outcome, rows: r.rows, ms: r.ms, error: r.error });
    if (r.outcome === 'retry') throw new Error(`${r.job}: try again later (${r.error})`);
  },
);

/** One Cloud Scheduler timer per entry in TIMERS, deployed as timers-<name>. */
export const timers = Object.fromEntries(TIMERS.map(t => [t.name, onSchedule(
  { region: REGION, schedule: t.schedule, timeZone: 'Asia/Kolkata', memory: '256MiB', timeoutSeconds: 60, retryCount: 1 },
  async () => {
    const q = getFunctions().taskQueue<Task>(QUEUE);
    const tasks = t.tasks();
    for (const task of tasks) await q.enqueue(task, { dispatchDeadlineSeconds: 540 });
    logger.info('timer', { timer: t.name, queued: tasks.length });
  },
)]));
