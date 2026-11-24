# Flowmerce-Sync: the Shopify sync backend

Copies **Shopify orders, order lines, parcels (fulfillments), parcel events and tracking numbers** for RBP and CPC into
the Supabase ERP project, schema `flowmerce`, so Flowmerce screens read the database instead of calling Shopify.
It **only reads Shopify** and never writes to it.

Built 24 Nov 2026 in the same style as `Sellora-Backend` (same Firebase project, same secrets, same deploy pattern),
as its own codebase `flowmerce-sync`. Deploying it never touches `sellora-live` or `rone-capture`.

## What runs

| Function | When | What it does |
|---|---|---|
| `flowmerceShopifyOrders` | every 15 min | orders **changed** since the last run (with a 10-minute overlap), for RBP then CPC. The first run ever takes the last 3 days. |
| `flowmerceShopifyBackfill` | every 5 min | walks back through **all older orders**, a few pages per run, until the first order; then stops. **Off** until switched on in `flowmerce.sync_job`. |
| `flowmerceShopifyWebhook` | when Shopify calls | checks the signature, keeps the message once, re-reads that order and saves it, all within a second or two |

Every run writes one line to `flowmerce.sync_run` (rows read and saved, errors). That line is what the screens show as "data as of …".

## How it keeps the ERP database light
- One database call per **page** of orders (`flowmerce.ingest_shopify_orders`), saved in one transaction.
- Only changed orders are fetched. Nothing is ever rebuilt whole. A lock stops two copies running at once.
- The raw copy is saved only when the order really changed.
- Shopify's limits are respected: the page size shrinks if a query is too big, and it waits when the request budget runs low.

## Files

| File | Job |
|---|---|
| `src/index.ts` | the **only** Firebase file (timers + web address). Swap it on "Firebase zero" day. |
| `src/orders.ts` | the job: cursor, pages, save, finish |
| `src/shopify.ts` | Shopify GraphQL reader (read-only) |
| `src/map.ts` | Shopify answer → our columns. **No names, emails, phones, street addresses or note text** pass. |
| `src/webhook.ts` | signature check, store detection, keep-once, re-read |
| `src/db.ts` | calls the database functions (`job_start`, `ingest_shopify_orders`, `job_finish`, `webhook_keep`, `webhook_done`) |
| `test/*.test.ts` | `npm test` — 10 tests, every outside service faked. Passed 24 Nov 2026. |
| `sql/` | the whole `flowmerce` schema, files 01–12, exactly as applied to the ERP project (migrations `flowmerce_01_…` to `flowmerce_12_…`) |

Deploy workflow: `.github/workflows/flowmerce-sync.yml`.

## To go live (in order)
1. **Supabase → Project Settings → API → Exposed schemas:** add `flowmerce`. The backend calls the database functions through the API.
2. ~~Move this folder into ridhi-apps~~ — done 24 Nov 2026 (branch `flowmerce-sync`).
3. **Firebase secrets.** These already exist for Sellora and are reused: `SUPABASE_SERVICE_KEY`, `SHOPIFY_STORE`, `SHOPIFY_TOKEN`, `CPC_SHOPIFY_STORE`, `CPC_SHOPIFY_TOKEN`.
   **Add two new ones**, the webhook signing key of each store (Shopify admin → Settings → Notifications → Webhooks, or the app's client secret if the webhooks are app-created):
   ```
   firebase functions:secrets:set SHOPIFY_WEBHOOK_SECRET_RBP --project price-research-48ff3
   firebase functions:secrets:set SHOPIFY_WEBHOOK_SECRET_CPC --project price-research-48ff3
   ```
   They're the same values as the `shopify-os` edge function's `SHOPIFY_WEBHOOK_SECRET_RBP` / `_CPC`.
4. **Shopify token access:** the token needs `read_orders` (and `read_fulfillments` / `read_assigned_fulfillment_orders` if Shopify asks). For UTMs, `customerJourneySummary` is used when allowed; if not, it is skipped by itself.
5. **Push to main.** GitHub builds, tests and deploys `flowmerce-sync`.
6. **Watch the first run:** `select * from flowmerce.sync_run order by started_at desc limit 5;`
7. **Webhooks:** in each store, add a webhook for each topic below to the function's address
   (`https://asia-south1-price-research-48ff3.cloudfunctions.net/flowmerceShopifyWebhook`, shown after deploy):
   `orders/create, orders/updated, orders/cancelled, orders/paid, orders/fulfilled, fulfillments/create, fulfillments/update, refunds/create`.
   Keep the existing shopify-os webhooks; Shopify sends to both.
8. **Backfill (all older orders):** once steps 6–7 look right:
   `update flowmerce.sync_job set is_enabled = true where stream = 'shopify.orders' and mode = 'backfill';`
