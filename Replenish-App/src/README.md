# Replenish app — source

Since 1 Oct 2026 this folder is the source of the page. `public/index.html` is **generated** from it; do not edit that
file by hand (the tools refuse to overwrite or build from a hand-edited copy).

```
src/
  index.html      the page: head, screen markup, and three include lines
  styles.css      the stylesheet (inside <style>)
  appv.js         the small classic script: "is this tab still on the live build?"
  app/ORDER       the order the app files are joined in (every .js file under app/ listed exactly once)
  app/<group>/    the app itself, one ES module cut into files and filed by group:
    core/           setup, sign-in, navigation, backend calls, database layer (read, write, live copies, history),
                    gates, lookups, look-alike SKUs, edit dialog, filters, installed app, version check
    replenishment/  Replenishment, article review, priority, revenue target, POs, follow-ups, Top ASIN, India stock,
                    In Production, packing list + labels, FBA box template, India -> USA express
    shopify/        Shopify orders, bulk entry, orders to make, production bucket, returns, delivery days
    orders/         sales orders, Order Console and its views, demand, tracking, reserve, delete requests
    production/     Job Work, attendance, press, QC, WhatsApp, Job Work corrections
    vendors/        orders/ portal/ rfd/ printing/ greige/
    inventory/      finished goods (all parts), FBA dispatch, store, fabric, accessories, Amazon listing status
    masters/        master database, masters, ASIN, recipes, SKU codes, cloth per piece
    people-pay/     Finance & HR, printer rates, payouts, vendor payout
    reports/        reports, last week, charts, analysis, day-by-day target, Shopify dispatch
    dashboard/      management dashboard
    shared/         adjustments, courier templates, imported orders (also copied in Sellora today)
```

## Workflow

1. Edit files in `src/`. (`tests/src_patch.py` makes exact-text edits without needing to know which file holds the text.)
2. `node tests/assemble.js` — joins `src/` into `public/index.html`. `--check` only compares.
3. Run the tests as before (`node tests/prod-test.js`, `shop-test`, `tabs-test`, `load-test`, `appv-test`, `fba-test`, `live-test`).
   prod-test's first check fails if `public/index.html` is not what `src/` makes.
4. `node tests/build-dist.js` (refuses if step 2 was skipped), then `firebase deploy --only hosting` as before.

## Why the app files are joined, not imported

The app was one `<script type="module">`, so every function and variable shares one scope. Joining the files in order
keeps that scope exactly, so moving code between files needs no code change and cannot change behaviour. Order
matters: top-level `const`/`let` and statements run in file order, so code is moved between files only with the tests
green after each move. Turning groups into real imported modules that load when their tab opens is a later step of the
module plan (https://claude.ai/artifact/QhwqZHFWWDCeMspHrsNHvd).

A group's files are not next to each other in ORDER yet: they sit where the code always was, because moving a piece
past code that uses it at load time would break the page. A new file goes into its group folder and onto the line of
ORDER where its code has to run.
