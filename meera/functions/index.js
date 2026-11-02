/* MEERA'S SEARCH ON FIREBASE CLOUD FUNCTIONS (master plan D.2; Ravi, 2 Nov 2026: "NO warm instance … max 2 instances, so
 * it can never run up a bill"). Only the Firebase part lives here; the search itself is service.js (portable).
 * Deployed BY HAND from the office computer with the Firebase tool, only on Ravi's "live karo" (meera/firebase/README.md). */
import { onRequest } from 'firebase-functions/v2/https';
import { readFileSync } from 'node:fs';
import { makeService } from './service.js';

const here = p => new URL(p, import.meta.url);
const files = {
  bank: JSON.parse(readFileSync(here('./data/meera-bank.json'), 'utf8')),
  walks: JSON.parse(readFileSync(here('./data/meera-walks.json'), 'utf8')),
  words: (b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(readFileSync(here('./data/meera-words.bin'))),
  version: JSON.parse(readFileSync(here('./data/version.json'), 'utf8')).v,
};
const service = makeService({ files, env: { FIREBASE_PROJECT_ID: 'price-research-48ff3', ROUTER_URL: 'https://meera-router.erp-9a0.workers.dev' } });

export const meeraSearch = onRequest({
  region: 'asia-south1',   // Mumbai — a Tier 1 price region
  minInstances: 0,         // no warm instance: nothing is paid while nobody asks
  maxInstances: 2,         // never more than two at once, whatever happens
  memory: '1GiB',          // she uses ~280 MB; 1 GiB comes with a whole CPU, so she starts in ~0.8 s
  cpu: 1,
  concurrency: 40,         // one instance answers many questions at once (each ~21 ms)
  timeoutSeconds: 15,
  invoker: 'public',       // the browser calls it; service.js lets in only the ERP's pages, and /search only signed-in staff
}, async (req, res) => {
  const r = await service.handle({ method: req.method, path: req.path, origin: req.get('origin'), authorization: req.get('authorization'), body: req.body });
  res.status(r.status).set(r.headers).send(r.body);
});
