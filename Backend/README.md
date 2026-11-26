# R-one backend

Our own backend. It replaces Apps Script (Pricing-API first, then the other scripts) one route and one timer at a
time, until Apps Script is at zero. Node.js + TypeScript on Firebase Functions, data in Supabase.

## The method: same door, then switch

The new backend answers **the same requests, in the same shape**, as Apps Script's `doGet`/`doPost`: GET with
`?key=…&route=…`, POST with JSON sent as text/plain, always JSON with `ok: true/false`. So a page can be pointed at it
**one route at a time** and nothing else changes. Every route is proven with the parity tool before any page uses it.
The full list, and where each route stands, is in [ROUTES.md](ROUTES.md).

| Part | Where |
|---|---|
| Front door | `src/lib/router.ts`: key check, route lookup, sign-in for routes that change things, errors shaped like Apps Script |
| Routes | `src/routes/`: one file per route, listed in `src/routes/index.ts` |
| Timer jobs | `src/lib/jobs.ts` `runJob`: one row per run in `backend.job_runs`; `keepOldIfEmpty` never saves empty over good |
| Amazon login | `src/lib/amazon.ts`: login token (cached), marketplace, host, ported from `Pricing-API/SpApi.gs` |
| **Amazon gateway** | `src/lib/gateway.ts`: the ONLY way to call Amazon. Checks the switches, waits under Amazon's limit, listens to "slow down", never turns an error into an empty answer, counts every call |
| Amazon's limits | `src/lib/amazon-limits.ts`: rate and burst for every kind of call; a call that isn't listed is refused |
| Switches | `src/lib/controls.ts` + table `backend.controls`: pause everything, pause a job, who owns each dataset (Apps Script or this backend), our share of the limits |
| Reports | `src/lib/reports.ts`: reuse a report from the last hour before asking for a new one; collect when ready |
| Speed limit store | `src/lib/limiter.ts` + `backend.take_token` (`sql/backend_gateway.sql`): one count shared by every running copy |
| Supabase | `src/lib/db.ts`, schema `backend` (`sql/backend_core.sql`) |
| Same-answer check | `src/lib/parity.ts`, `tools/parity.ts`, recorded answers in `test/golden/` |
| Runs on | Firebase project `price-research-48ff3`, codebase `rone-backend`, function `roneApi`, region `asia-south1` (Mumbai) |

## Working on it

Node 24+ runs the TypeScript directly, so the tests need nothing installed and no keys (every outside service is faked):

```
node --test "test/*.test.ts"
```

## Running it as one Node process (this PC, or a plain server such as DigitalOcean)

`src/standalone.ts` runs the same routes, jobs and rules without Google: a plain web server, timers and an
in-memory queue, and Firebase sign-in checked against Google's public keys (no Firebase packages needed).

1. Copy `.env.example` to `.env` in this folder and fill in the values (never commit `.env`; git ignores it).
   Only `SUPABASE_SERVICE_KEY` is needed to start; add `API_KEY` to call routes.
2. Start: `npm run local` (same as `node --env-file=.env src/standalone.ts`). On a server: `npm start`, with the
   settings given as environment variables and `HOST=0.0.0.0`.
3. Check: `http://127.0.0.1:8080/health` (no key), then `http://127.0.0.1:8080/?weekly=keys&key=<API_KEY>`.
   In Supabase: `select * from backend.last_runs;` shows a `heartbeat` row once a run is logged.

It listens on this computer only unless `HOST` says otherwise, and every Amazon dataset stays owned by Apps Script
until a switch in `backend.controls` changes, so nothing is fetched from Amazon.

Compare a route on real data, once deployed (settings in your shell, never in a file):

```
node tools/parity.ts ping
```

## Setup, once

1. **Supabase:** run `sql/backend_core.sql`, then `sql/backend_gateway.sql`, in the SQL editor of ERP data, then add
   `backend` under Project Settings → Data API → Exposed schemas. Every dataset starts owned by Apps Script, so the
   gateway fetches nothing until a row in `backend.controls` is changed to `"backend"`.
2. **Secrets:** `API_KEY` is new: copy it from Pricing-API's Script Properties. The others are already in Secret Manager
   for `sellora-live`. From the office PC or Google Cloud Shell: `firebase functions:secrets:set API_KEY --project price-research-48ff3`.
3. **Deploy:** GitHub → Actions → "R-one backend — test, deploy" → Run workflow on `main`. Pushes only run the tests;
   deploying is by hand until the first routes are proven.
