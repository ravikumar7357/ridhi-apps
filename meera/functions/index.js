/* MEERA'S SEARCH ON FIREBASE CLOUD FUNCTIONS (master plan D.2; Ravi, 2–3 Nov 2026: "NO warm instance … max 2 instances",
 * "it must never cost even one cent"). Only the Firebase part lives here; the search is service.js (portable), the stop
 * is stop.js, the cent alarm is alarm.js. Deployed BY HAND from the office computer with the Firebase tool, only on Ravi's
 * "live karo" (meera/firebase/README.md). Keys come from meera/functions/.env, written at deploy and never committed. */
import { onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { readFileSync } from 'node:fs';
import { makeService } from './service.js';
import { makeAlarm } from './alarm.js';
import { stopServing } from './stop.js';

const here = p => new URL(p, import.meta.url);
const env = { FIREBASE_PROJECT_ID: 'price-research-48ff3', ROUTER_URL: 'https://meera-router.erp-9a0.workers.dev',
  METER_KEY: process.env.METER_KEY || '', STOP_KEY: process.env.STOP_KEY || '' };
let service = null;
const getService = () => service || (service = makeService({ env, deps: { stopServing }, files: {
  bank: JSON.parse(readFileSync(here('./data/meera-bank.json'), 'utf8')),
  walks: JSON.parse(readFileSync(here('./data/meera-walks.json'), 'utf8')),
  words: (b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(readFileSync(here('./data/meera-words.bin'))),
  version: JSON.parse(readFileSync(here('./data/version.json'), 'utf8')).v,
} }));

export const meeraSearch = onRequest({
  region: 'asia-south1',   // Mumbai — a Tier 1 price region
  minInstances: 0,         // no warm instance: nothing is paid while nobody asks
  maxInstances: 2,         // never more than two at once, whatever happens
  memory: '1GiB',          // she uses ~280 MB; 1 GiB comes with a whole CPU, so she starts in ~0.8 s
  cpu: 1,
  concurrency: 40,         // one instance answers many questions at once (each ~21 ms)
  timeoutSeconds: 10,      // short: a stuck request is cut off, not billed for long
  invoker: 'public',       // the browser calls it; service.js lets in only the ERP's pages, and /search only signed-in staff
}, async (req, res) => {
  const r = await getService().handle({ method: req.method, path: req.path, origin: req.get('origin'), authorization: req.get('authorization'), body: req.body });
  res.status(r.status).set(r.headers).send(r.body);
});

/* the cent alarm: the project's budget messages (topic "meera-budget"); any cost above 0 → her search stops */
const alarm = makeAlarm({ env, stopServing });
export const meeraCostAlarm = onMessagePublished({
  topic: 'meera-budget',
  region: 'asia-south1',
  minInstances: 0,
  maxInstances: 1,
  memory: '256MiB',        // a few lines of work per message, several messages a day
  timeoutSeconds: 30,
  retry: false,
}, async event => {
  let msg = {};
  try { msg = event.data.message.json || JSON.parse(Buffer.from(event.data.message.data || '', 'base64').toString('utf8')); } catch (e) { /* not a budget message */ }
  await alarm.onBudget(msg);
});
