/* R-one's backend as ONE ordinary Node process: on this PC for testing, or on a plain server (DigitalOcean).
 * Same routes, jobs and rules as the Google version (index.ts); only the wiring differs:
 *
 *   web server   lib/http-server.ts  (Google: onRequest)
 *   timers       setInterval          (Google: Cloud Scheduler)
 *   queue        lib/local-queue.ts   (Google: Cloud Tasks)
 *   sign-in      lib/firebase-token.ts (Google: firebase-admin)
 *
 * Settings come from the environment, the same names as everywhere else (lib/env.ts). On this PC they sit in
 * Backend/.env, which git never takes (see .env.example). Start:  npm run local   (or: node --env-file=.env src/standalone.ts)
 *
 * Safe by default: listens on this computer only (HOST 127.0.0.1), and every Amazon dataset stays owned by Apps
 * Script until a switch in backend.controls says otherwise, so nothing is fetched from Amazon. */

import { processEnv, SUPABASE_URL } from './lib/env.ts';
import { Db } from './lib/db.ts';
import { AmazonGateway } from './lib/gateway.ts';
import { DbLimiter } from './lib/limiter.ts';
import { loadControls } from './lib/controls.ts';
import { runTask } from './lib/tasks.ts';
import { LocalQueue, startTimers } from './lib/local-queue.ts';
import { startServer } from './lib/http-server.ts';
import { verifyFirebaseIdToken } from './lib/firebase-token.ts';
import { ROUTES } from './routes/index.ts';
import { SAVE_ROUTES } from './saves/index.ts';
import { JOBS } from './jobs/index.ts';
import { TIMERS } from './jobs/timers.ts';

const env = processEnv;
const log = (line: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

if (!env('SUPABASE_SERVICE_KEY')) {
  console.error('SUPABASE_SERVICE_KEY is not set. Put it in Backend/.env (copy .env.example) and start again.');
  process.exit(1);
}

const db = new Db(SUPABASE_URL, env('SUPABASE_SERVICE_KEY'), 'backend');
const gateway = async () => new AmazonGateway({ env, limiter: new DbLimiter(db), controls: await loadControls(db) });
const projectId = env('FIREBASE_PROJECT_ID') || 'price-research-48ff3';
const startedAt = new Date().toISOString();

const queue = new LocalQueue(t => runTask(t, { jobs: JOBS, env, db, gateway }), {
  concurrency: Number(env('QUEUE_CONCURRENCY')) || 2,
  log,
});
const timers = startTimers(TIMERS, t => queue.enqueue(t), { runAtStart: env('RUN_AT_START') !== 'no', log });

const port = Number(env('PORT')) || 8080;
const host = env('HOST') || '127.0.0.1';
await startServer({
  env, db, gateway, log,
  verifyIdToken: t => verifyFirebaseIdToken(t, projectId),
  apiRoutes: ROUTES,
  saveRoutes: SAVE_ROUTES,
  health: () => ({ startedAt, timers, queue: queue.stats() }),
}, port, host);

log({ msg: `R-one backend running on http://${host}:${port}`, timers, check: `http://${host}:${port}/health` });
