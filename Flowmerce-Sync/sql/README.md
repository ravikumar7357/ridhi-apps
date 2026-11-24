# Flowmerce: one schema (`flowmerce`)

Everything Flowmerce stores lives in **one Postgres schema, `flowmerce`**. It was built from `Downloads/data-requirements.html`
and `Flowmerce/db/schema.sql` on 24 Nov 2026.

**Status: installed in the ERP Supabase project (xkpktnsdmpkwaingvdbd) on 24 Nov 2026** as migrations
`flowmerce_01_…` to `flowmerce_10_…`: 108 tables (all with RLS), 24 views. Shipping and approval tests passed
and were rolled back. Tables are empty until sync jobs are built. Files 01–10 here match what was applied.
File 09 = the Flowmerce team's schema review (schema-review.html); file 10 = function permissions.

**Sign-in: Supabase Auth** (owner decision 24 Nov 2026, file 11 / migration `flowmerce_11_…`). An admin adds a row to
`flowmerce.invite`; when that person signs in with a confirmed email, a trigger on `auth.users` makes them a member with the
invited role and stores. Signing in without an invite gives no access. The app reads `flowmerce.my_access` after login.
The ERP keeps its own Firebase sign-in; Flowmerce users are separate Supabase Auth users.

> The older `000_…099_` files in this folder were the first, multi-schema draft. They are replaced by `01`–`07`; delete them.

## Files (run in order)

| File | What it creates |
|---|---|
| `01_foundation_shop.sql` | workspace, store, member (Supabase Auth), teams, settings, write switches (all off), access helpers, providers, connections (Vault names only), sync jobs (cursor + lock), sync log, webhooks, raw API/webhook copies (13-month purge), Shopify shop, product, variant, image, collection, location, stock, catalog change history, shop_order, order_line, fulfillment (+ lines, events), refund (+ lines), order_return, blog, blog_article |
| `02_analytics_ads.sql` | `sq_*` ShopifyQL (10 tables), `gsc_*` Search Console, `ga4_*` GA4, `ads_*` Meta + Google (account, campaign, group, creative, ad, keyword, conversion action, daily, breakdown, search terms, change log, targets), fx_rate, order_attribution |
| `03_ship_team.sql` | carrier, carrier_alias, status_map, shipment, tracking, team_mark, scan (+ trigger updating tracking), carrier_call, ship_exception, ship_claim, ship_rate_card, ship_cost, order_event, order_review, `mcf_*` + fba_stock, `seo_*`, `cro_*`, `ai_*` |
| `04_actions_security.sql` | action_policy, action, approval, `approve_action()`, notification, audit_log + audit triggers, grants and row-level security on every table |
| `05_flowmerce_screens.sql` | the views and RPCs the screens read, incl. today's Shipping names: `shipment_list`, `shipping_summary`, `feed_freshness`, `diagnostics_*`, `carrier_performance`, `carriers`, `tracking_scans`, `events`, `shipping_exceptions`, `sync_runs`, `refresh_from_tracker()`, `set_team_mark()` |
| `06_seed_ridhi.sql` | workspace Ridhi, stores RBP + CPC (with ERP brand names), shipping thresholds, switches off |
| `07_erp_links_optional.sql` | **only if installed in the ERP project**: read-only views joining Flowmerce to `core.skus`, `sales.shopify_orders`, `sales.shopify_order_notes` (MCF), `planning.amazon_stock`, `sellora.sales_daily` |

## What already exists in the ERP Supabase (checked 24 Nov 2026)

ERP project, 978 MB: `core` (SKU master, 8,093 SKUs; access; settings; Firestore bridge `sync_inbox`), `sales` (orders,
`shopify_orders` 4,015, `shopify_order_notes` with MCF fields, Amazon listings/POs), `production` (32 tables), `stock`,
`planning` (Amazon + India stock), `shipping` (boxes, packing lists), `hr`, `history` (audit), `sellora` (Shopify/Amazon
sales daily + hourly, ads daily). **No Flowmerce tables there today.** None of the names in `flowmerce` clash with it.

## Connect Flowmerce

1. Supabase → Project Settings → API → Exposed schemas: add `flowmerce`.
2. Flowmerce `.env` (server only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SHIPPING_SCHEMA=flowmerce`.
3. Restart. Shipping screens read the same names as today. They stay empty until sync jobs fill `shop_order`, `fulfillment`, `shipment`, `tracking`.

## Check before use

- Run 01–06 on an empty project first and fix any errors.
- Currency / time zone in `06` are placeholders (USD, America/New_York).
- Section 14 questions in the requirements doc are still open.
