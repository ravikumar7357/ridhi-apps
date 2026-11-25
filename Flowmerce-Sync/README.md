# Flowmerce-Sync: the Shopify sync backend

Copies **Shopify orders, order lines, parcels (fulfillments), parcel events, returns and tracking numbers** for RBP and
CPC into the Supabase ERP project, schema `flowmerce`, so Flowmerce screens read the database instead of calling Shopify.
It **only reads Shopify** (the one thing it creates there is its own webhooks).

Its own Firebase codebase `flowmerce-sync` (project price-research-48ff3, region asia-south1). Deploying it never touches
`sellora-live` or `rone-capture`. **Live since 24 Nov 2026 16:44 IST.**

## What runs

| Function | When | What it does |
|---|---|---|
| `flowmerceShopifyOrders` | every 15 min | orders **changed** since the last run (10-minute overlap), RBP then CPC |
| `flowmerceShopifyBackfill` | every 5 min | **all older orders**, a few pages per run, until the first order; then stops. **Off** until switched on in `flowmerce.sync_job` |
| `flowmerceShopifySetup` | every 30 min | the **Flowmerce app registers its own webhooks** in each store: creates missing topics, moves any pointing elsewhere, records them in `flowmerce.webhook_subscription` |
| `flowmerceShopifyWebhook` | when Shopify calls | checks the signature, keeps the message once, re-reads the order and saves it. Also `app/uninstalled` (store disconnected) and the 3 required privacy webhooks |

Every run writes one line to `flowmerce.sync_run`; that is what the screens show as "data as of …".

## Shopify access
1. **Each store's own Flowmerce Shopify app** (Dev Dashboard — one app per store, because the stores are in different
   organisations): `FLOWMERCE_RBP_CLIENT_ID` / `_SECRET` for Ridhi and `FLOWMERCE_CPC_CLIENT_ID` / `_SECRET` for CPC are swapped
   for that store's token (~24 h, client-credentials grant), kept in memory only.
2. **Fallback:** Sellora's store tokens (`SHOPIFY_TOKEN`, `CPC_SHOPIFY_TOKEN`), so the job never stops if the app can't log in. The log says why.

Webhooks the app makes itself are signed with the **app's client secret**; webhooks made by hand in Shopify admin with
the store's key (`SHOPIFY_WEBHOOK_SECRET_RBP` / `_CPC`). Both are accepted.

Webhook topics: orders/create, orders/updated, orders/cancelled, orders/paid, orders/fulfilled, refunds/create,
fulfillments/create, fulfillments/update, returns/request, returns/approve, returns/close, app/uninstalled.
Privacy webhooks (customers/data_request, customers/redact, shop/redact) can't be made by the API: set their address once
in Dev Dashboard → App → Configuration → **Compliance webhooks** (same address as below).

Webhook address: `https://asia-south1-price-research-48ff3.cloudfunctions.net/flowmerceShopifyWebhook`

## How it keeps the ERP database light
- One database call per **page** of orders (`flowmerce.ingest_shopify_orders`), saved in one transaction.
- Only changed orders are fetched. Nothing is ever rebuilt whole. A lock stops two copies running at once.
- The raw copy is saved only when the order really changed.
- Shopify's limits are respected: the page size shrinks if a query is too big, and it waits when the request budget runs low.

## Nightly trim (database, not Firebase)
pg_cron job `flowmerce-trim-old-data` (every 5 min, 02:30–03:25 IST) calls `flowmerce.trim_old_data()` (`sql/16`):
orders are kept forever; for parcels delivered 30+ days ago the in-between IN_TRANSIT scans are deleted (first and last
in-transit scan and every other step are kept); raw Shopify answers go after 30 days, processed webhook messages after 14.
At most 10,000 rows per table per call, so the ERP's WAL stays calm.

## Files

| File | Job |
|---|---|
| `src/index.ts` | the **only** Firebase file (timers + web address). Swap it on "Firebase zero" day. |
| `src/auth.ts` | app login (client credentials) with the store-token fallback |
| `src/orders.ts` | the orders job: cursor, pages, save, finish |
| `src/setup.ts` | the app's own webhooks |
| `src/shopify.ts` | Shopify GraphQL reader |
| `src/map.ts` | Shopify answer → our columns. **No names, emails, phones, street addresses or note text** pass. |
| `src/webhook.ts` | signature check, store detection, keep-once, re-read, uninstall, privacy |
| `src/db.ts` | calls the database functions |
| `test/*.test.ts` | `npm test` — 20 tests, every outside service faked |
| `sql/` | the whole `flowmerce` schema, files 01–14, as applied to the ERP project (migrations `flowmerce_01_…` to `flowmerce_14_…`) |

Deploy workflow: `.github/workflows/flowmerce-sync.yml` (push to main = deploy).

## Before deploying the app version
Firebase refuses a deploy when a declared secret is missing, so these must exist first (Secret Manager, price-research-48ff3):
`FLOWMERCE_RBP_CLIENT_ID`, `FLOWMERCE_RBP_CLIENT_SECRET`, `FLOWMERCE_CPC_CLIENT_ID`, `FLOWMERCE_CPC_CLIENT_SECRET`.
`SHOPIFY_WEBHOOK_SECRET_RBP` / `_CPC` get a new version = that store's app client secret. Each app is installed on its own
store (done 24 Nov 2026), and the **Compliance webhooks** address is set in each app in the Dev Dashboard.

## Load all older orders
`update flowmerce.sync_job set is_enabled = true where stream = 'shopify.orders' and mode = 'backfill';`
(needs `read_all_orders`, which the app has).
