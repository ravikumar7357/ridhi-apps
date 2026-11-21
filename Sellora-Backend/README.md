# Sellora backend

Sellora's own backend. Every 10 minutes it reads Amazon (Sales API, Ads API), Shopify and Meta and keeps the figures
in Supabase, schema `sellora`. Its first user is the **Live vs Last Year** page: today Apps Script feeds that page
through a published Google Sheet, and this backend replaces that feed.

| Part | Where |
|---|---|
| Code | `src/`: `tick.ts` is the 10-minute run; `amazon.ts`, `ads.ts`, `shopify.ts` and `meta.ts` call the APIs; `backfill.ts` copies the history once |
| Database | `sql/sellora_live.sql`: tables, plus `sellora.page_data()`, the page's one call |
| Runs on | Firebase project `price-research-48ff3`, codebase `sellora-live`, region `us-central1`, function `selloraLiveTick` |
| Goes live | A push to `main` that touches `Sellora-Backend/` runs `.github/workflows/sellora-backend.yml` (build, test, deploy) |
| What each run did | Supabase `sellora.fetch_runs`, one row per step. Also the Firebase console logs. |

## What a run does

For each brand (SP = Ridhi, CPC), each step runs on its own, so one source failing never stops the others:

- **amazon_sales**: yesterday and today by Pacific hour, and the last 8 finished days by day. The days are read again
  because pending orders settle. The comparison days (same weekday last year, last week, 4 weeks ago) are read by the
  hour, once each.
- **shopify**: the last 3 days and today by Pacific hour and day, plus the comparison days once each. Sales are
  line-item price × quantity; voided orders are left out.
- **amazon_ads**: daily reports for Products, Brands and Display covering the last 7 days. Each run collects what the
  previous run asked for, then asks again.
- **meta_ads**: the last 7 days, in the ad account's own timezone. That timezone is stored with every row.
- **backfill**: once, ever. Copies about 800 days of history from Apps Script's published sheet. It never overwrites
  figures the APIs have written.

**Today is never stored as a day.** It stays in `sales_hourly` until it is over. This is what makes "Yesterday" always
a whole day.

## Setup, once

1. **Supabase.** Run `sql/sellora_live.sql` in the SQL editor. Then add `sellora` under Project Settings → Data API →
   Exposed schemas.
2. **Firebase.** The project must be on the Blaze plan. Set a budget alert of about $10.
3. **Secrets.** Add them in Firebase's Secret Manager, never in code or GitHub. The names are the same as Apps Script's
   Script Properties, so the values can be copied one for one. From the office PC or Google Cloud Shell, run this for
   each name:

   ```
   firebase functions:secrets:set NAME --project price-research-48ff3
   ```

   | Secret | What it is |
   |---|---|
   | `SUPABASE_SERVICE_KEY` | Already there: the Supabase key the `rone-capture` functions use. Shared, not copied. |
   | `SP_CLIENT_ID`, `SP_CLIENT_SECRET`, `SP_REFRESH_TOKEN` | Ridhi's Amazon Sales API (SP-API) |
   | `CPC_CLIENT_ID`, `CPC_CLIENT_SECRET`, `CPC_REFRESH_TOKEN` | CPC's Amazon Sales API |
   | `SP_ADS_CLIENT_ID`, `SP_ADS_CLIENT_SECRET`, `SP_ADS_REFRESH_TOKEN`, `SP_ADS_PROFILE_ID` | Ridhi's Amazon Ads API |
   | `CPC_ADS_CLIENT_ID`, `CPC_ADS_CLIENT_SECRET`, `CPC_ADS_REFRESH_TOKEN`, `CPC_ADS_PROFILE_ID` | CPC's Amazon Ads API |
   | `SHOPIFY_STORE`, `SHOPIFY_TOKEN` | Ridhi's Shopify store (`…myshopify.com`) and Admin API token (`shpat_…`) |
   | `CPC_SHOPIFY_STORE`, `CPC_SHOPIFY_TOKEN` | CPC's Shopify store and token |
   | `META_TOKEN`, `META_AD_ACCOUNT` | Ridhi's Meta token and ad account (`act_…`). Use a **System User** token with `ads_read`: a personal token expires in about 60 days. |
   | `CPC_META_TOKEN`, `CPC_META_AD_ACCOUNT` | CPC's Meta token and ad account. If `CPC_META_TOKEN` is `none`, Ridhi's token is used for CPC's account. |

   Every name must exist, because the deploy checks them all. For something that doesn't apply, set the value to
   `none`: for example a profile ID you want found automatically, or a brand with no Meta account. That part is then
   skipped.
4. **GitHub.** The workflow deploys with the same key as Sellora's pages (`FIREBASE_SERVICE_ACCOUNT`, the service
   account `github-action-1397622174@…`). Give that account the extra roles listed at the top of
   `.github/workflows/sellora-backend.yml`, in Google Cloud → IAM. A separate `SELLORA_BACKEND_DEPLOY_KEY` is used
   instead if it is ever set.
5. **Go live.** Merge to `main`. The workflow builds, tests and deploys. To run it once by hand: Google Cloud console →
   Cloud Scheduler → `firebase-schedule-selloraLiveTick-…` → Force run.

## Checking it

```sql
-- the last run of each step
select distinct on (job, brand) job, brand, finished_at, ok, rows_written, error
from sellora.fetch_runs order by job, brand, started_at desc;

-- yesterday, both brands, both channels
select * from sellora.day_totals where day = current_date - 1;
```

## Working on it

Node 24 runs the TypeScript directly, so the tests need nothing installed:

```
node --test "test/*.test.ts"
```

The tests fake every outside service (Amazon, Ads, Shopify, Meta, Google Sheets, Supabase), so they need no keys. The
deploy build compiles `src/` to `lib/` with `tsc`.
