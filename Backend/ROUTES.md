# Moving Apps Script to the new backend: every route and timer

Status: **AS** = still Apps Script · **NEW** = answered by `roneApi`, pages switched · **SHADOW** = built, compared with
`tools/parity.ts`, pages not switched yet. Read from `Pricing-API/Code.gs` on 24 Nov 2026. Re-check Code.gs before moving
a route: the live Apps Script has files that aren't in the repo.

## How a route moves

1. Read the Apps Script function behind it. Write down what it answers, including the odd parts.
2. Record a real answer: `node tools/parity.ts <route> --record` → copy it into `test/golden/<route>.json`.
3. Build it in `src/routes/`, add it to `src/routes/index.ts`, and write a test that compares with the golden file.
4. Deploy. Run `node tools/parity.ts <route>` until it says "Same answer" on real data (status SHADOW).
5. Switch the pages for that route (one setting in `core/backend.js`, later). Status NEW.
6. After two quiet weeks, delete the route from Apps Script.

## Wave 1 — read-only, small (start here)

| Route | Method | What it does | Status |
|---|---|---|---|
| `ping` | GET | Key + Ridhi's Amazon login work | built 24 Nov, tested; not deployed yet |
| `cacheState` | GET | State of the nightly cache run | AS — **cannot move yet**: it reads the Apps Script property `NIGHTLY_STATE`. It moves with the nightly job (Wave 3) |
| `listing:periods` | GET | Brand Analytics report periods | built 26 Nov, tested; not deployed yet |
| `weekly:keys` | GET | Week keys for the PPC & Organic page | built 26 Nov, tested; not deployed yet |
| `ads:profiles` | GET | Ads profiles each brand can see | built 26 Nov, tested; not deployed. Goes through the gateway: answers "not fetched" per brand until `owner:ads-profiles` = `backend` |
| `parents`, `children`, `imgs` | GET | Catalogue: parents, variations, images | AS |
| `imgsku`, `piclinks` | GET | Pictures by SKU, share links | AS |
| `asin` (default) | GET | Price, buy box, fees for one ASIN | AS |

## Wave 2 — Amazon "ask, then collect" (read-only, slower)

| Route | What it does | Status |
|---|---|---|
| `ads:ppcCreate`, `ads:ppcRange`, `ads:ppcStatus`, `ads:ppcFetch` | PPC reports | AS |
| `traffic:create`, `traffic:status`, `traffic:fetch` | Sales & traffic | AS |
| `ba:check`, `ba:create`, `ba:poll` | Brand Analytics | AS |
| `listing:sqpAsk`, `listing:sqpGet`, `listing:basketAsk`, `listing:basketGet`, `listing:basketAll` | SQP, market basket | AS |
| `age:create`, `age:poll`, `agNow:ask`, `agNow:get` | Inventory age | AS |
| `lh:create`, `lh:poll`, `lh:content`, `lh:aplus`, `lh:aplusasin`, `lh:aplusdoc`, `lh:bsr` | Listing health | AS |
| `listing:audit`, `listing:keywords`, `listing:review` | Listing audit | AS |
| `limg:get`, `limg:history`, `limg:page` | Image manager reads | AS |
| `lfix:get`, `lfix:schema`, `lfix:history`, `lfix:content`, `lfix:cat` | Listing fix reads | AS |
| `research`, `dd` | Product research, DataDive | AS |

## Wave 3 — sales caches and sheets (these read Google Sheets today; move with their data)

| Route | What it does | Status |
|---|---|---|
| `cache=<tab>`, `cache` | Nightly caches (daily, ads, weekly, …) | AS |
| `daily:sales`, `daily:recent`, `weekly:sales`, `sales30`, `sales30:chunk`, `sales:cat`, `sales:chunk` | Sales by day / week / SKU | AS |
| `live:yoy`, `live:range`, `live:hist`, `live:months` | Live vs last year (Sellora-Backend already has the data) | AS |
| `adState:build` | Ad state | AS |

## Wave 4 — Shopify

| Route | What it does | Status |
|---|---|---|
| `shopify:orders`, `shopify:orderIds`, `shopify:daily`, `shopify:skus`, `shopify:photos` | Orders and SKUs (move to GraphQL) | AS |
| `shopify:cacheSync`, `shopSkuBuild` | Shopify copies | AS |
| `shopify:fulfil` (POST) | Post tracking to Shopify | AS |

## Wave 5 — things that CHANGE something (POST; sign-in required in the new backend)

| Route | What it does | Status |
|---|---|---|
| `mcf:preview`, `mcf:create`, `mcf:status` | Amazon MCF orders | AS |
| `limg:patch`, `limg:upload`, `lfix:patch` | Change listings on Amazon | AS |
| `mail:po`, `mail:report` | Emails | AS |
| `notify:approval` | Email (today a GET; becomes POST + sign-in) | AS |
| `lads:put`, `lads:drop` | Old ads console data | AS |
| `ai:ask`, `ai:plan` | AI writing | AS |
| `creator:order`, `creator:report` | Content creators | AS |
| `inv=…` (status, run, stop, auto, seed, install, compare, diag, scopes) | FabriCrush Inventory app | AS |

Debug routes (`shoptest`, `propnames`, `mcfdiag`, `fuldiag`) are **not** moved. They are deleted with Apps Script.

## Timers

Every timer now goes on the queue: `src/jobs/timers.ts` lists the timers, each only puts tasks on `roneGet`'s queue,
and `src/jobs/index.ts` lists the jobs `roneGet` can run. The first one, `heartbeat` (every 30 min, does nothing but
log a row), proves timer → queue → roneGet → `backend.job_runs` before any real job moves.

| Timer | Today | New job | Status |
|---|---|---|---|
| `invTick` every 10 min (+ `invKick`) | Pricing-API InvSync.gs: orders, shipments, stock, Replenish snapshot | `jobs/inventory`, `jobs/shipments`, `jobs/replenish` | AS |
| `nightlyTick` every 10 min from 05:00 IST | Pricing-API Nightly.gs: caches | `jobs/ads`, `jobs/sales` (ask/collect) | AS |
| `liveSnapshotJob` every 15 min | Pricing-API SalesLive.gs | Sellora-Backend `selloraLiveTick` already does this | AS (retire) |
| `shopCacheTick` every 5 min | ShopifyCache.gs (built, off) | Shopify webhooks | AS |
| Repl-API timers (9 AM, 5 PM, 3 h, 6 h) | Repl-API Code.js | not needed (moved to Pricing-API on 25 Oct) | turn off |
| Backup 03:15 IST | Backup-Script | Supabase backups + `jobs/export` | AS |
| Checker 02:00 | R-one CHECKER | `jobs/reconcile` | AS |
| Report mails | "Fabricrush ERP mails" | `jobs/report-mail` | AS |
