# Sellora — source

Since 1 Oct 2026 this folder is the source of `public/index.html`, which is **generated** from it. Same layout and tools
as the Replenish app (see `Replenish-App/src/README.md`); the tools live in `Replenish-App/tests/` and take this app's
folder as an argument.

```
src/
  index.html      the page: head, screen markup, and two include lines
  styles.css      the stylesheet (inside <style>)
  app/ORDER       the order the app files are joined in (every .js file under app/ listed exactly once)
  app/<group>/    the app, one ES module cut into files and filed by group:
    core/           setup, rights mirror, sign-in, access, admin Access screen, navigation, settings, backend calls,
                    version check
    research/       By Amazon Link, New Product, Product Research, Keywords, fee tables, costing maths
    sales/          Sales Dashboard, Profit & Margin, Sales Analysis, Parent Listing Review, Brand Analytics
    listing/        Listing Health (+ its data), Listing Rules (+ tab), parent check, Listing Audit, launch, BSR Audit,
                    Listing Optimiser, Bought Together
    ads/            Deal Calendar, Planner, completed deals, HDA, account trends, Search Terms, Placement, PPC & Organic
    inventory/      Inventory Age
    shared/         adjustments, courier templates, imported orders (the Replenish app carries its own copies today)
    hidden/         Shopify Orders + Adjustments code: their tabs are hidden here since they moved to Replenish, but the
                    code still loads and runs. Kept, not removed.
```

## Workflow

1. Edit files in `src/` (`Replenish-App/tests/src_patch.py`: `Src('../../Pricing-App')` from that tests folder).
2. `node ../Replenish-App/tests/assemble.js --root .` from this folder — writes `public/index.html`.
3. Load the page and read the console (Sellora has no test suite).
4. `firebase deploy --only hosting` — its predeploy step refuses when `public/index.html` is not what `src/` makes.
