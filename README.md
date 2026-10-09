# Ridhi / Sellora apps — start here

This repository holds two web apps, their Google Apps Script backends and the tools that build and test them.

## The one thing to know first

**Do not read `public/index.html` or `dist/index.html` to understand the code.** They are *generated* files of
15,000–56,000 lines: every source file joined into one page, because the app runs as one script. The real code is
in each app's **`src/`** folder, split into small files and filed by group. Each `src/` has a README with the map.

The generated `public/index.html` says this in a banner at the top. Inside it, every source file begins with a
`FILE: src/app/...` comment and every group with a `GROUP:` heading. `dist/index.html` is the same page with the
comments stripped, and it is what is deployed.

## What is where

| Folder | What it is | Runs on | Source to read |
|---|---|---|---|
| `Replenish-App/` | **Replenishment / factory ERP**: FBA replenishment, Shopify orders, sales orders, production, vendors, inventory, masters, pay, reports | fabricrush-replenish.web.app (Firebase project `price-research-48ff3`) | `src/` — 131 files in 12 groups, see `src/README.md` |
| `Pricing-App/` | **Sellora**: research, sales, listing health, Image Manager, advertising | price-research-48ff3.web.app (same Firebase project) | `src/` — 41 files in 6 groups, see `src/README.md` |
| `shared/` | Code joined into both apps (adjustments, courier templates, imported orders) | — | the files themselves |
| `Pricing-API/` | Apps Script backend for Sellora and for Shopify/MCF. Amazon SP-API, Ads API, Shopify | Google Apps Script web app | 23 `.gs` files by topic. Start at `Code.gs`: a file map at the top, and the routes (`doGet` / `doPost`). Files load in the order set by `.clasp.json` `filePushOrder` |
| `Repl-API/`, `Repl-API-CPC/` | Apps Script backends for the Replenishment app, one per brand (Ridhi, CPC) | Google Apps Script | `Code.js` |
| `Backup-Script/` | Nightly backup of the database to Google Drive | Google Apps Script | `Code.gs` |
| `docs/` | Design notes (`module-plan.html` explains why `src/` exists) | — | — |

**Where the data lives:** Firestore (Sellora's caches and settings, `perms/{email}` access rights) and the
Realtime Database (`pt_*` nodes: production, orders, inventory). Both are in the Firebase project
`price-research-48ff3`. Access rules are in `firestore.rules` and in the Replenish app's database rules tool.

## How a change is made

1. Edit the files in `src/` (never `public/` or `dist/`; the tools refuse to build from a hand-edited copy).
2. Join them into the page:
   - Replenishment: `node Replenish-App/tests/assemble.js`
   - Sellora: `node Replenish-App/tests/assemble.js --root Pricing-App`
3. Test (Replenishment): `node Replenish-App/tests/prod-test.js`, plus `shop-test`, `tabs-test`, `load-test`,
   `appv-test` and `fba-test` in the same folder.
4. Deploy:
   - Replenishment: `node Replenish-App/tests/build-dist.js`, then `firebase deploy --only hosting` in `Replenish-App/`.
   - Sellora: `firebase deploy --only hosting` in `Pricing-App/`.
   - Apps Script: `clasp push -f`, then `clasp create-deployment -i <the existing deployment id>`. Reuse the same
     id, or the apps keep calling the old code.

## Why the code is one script, joined from files

Both apps began as a single HTML file with one `<script type="module">`, so every function shares one scope. In
October 2026 that script was cut into files without changing a line, and `tests/assemble.js` joins them back in the
order listed in `src/app/ORDER`. That keeps the shared scope exactly as it was. The cost is that a function in one
file can call a function in any other. To see who calls whom, run `node Replenish-App/tests/deps-report.js`. It
writes `src/deps.json`, which is generated and kept out of git.
