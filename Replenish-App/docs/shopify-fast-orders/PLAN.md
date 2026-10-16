# Fast Shopify Orders — the complete plan

Written 15 Oct 2026. Every phase is built and tested on the local copy first; nothing goes live without Ravi's go-ahead.

> **Status, 15 Oct 2026 (late): Phases 0–4 are BUILT on the local copy, and the Phase 5 side-by-side check is built
> into shadow mode. Nothing is deployed, pushed to Apps Script or committed.** Phase 5 itself is a week of running
> old and new together on the LIVE app, so it starts only with a deploy, on Ravi's go-ahead — runbook in Phase 5 below.
> `npm run check` in Replenish-App runs `tests/assemble.js --check`, `tests/shopify-copy-test.js` (118 checks) and
> `tests/delta-test.js` — all pass. The "before" timing has still not been taken (it needs a live Shopify read).
>
> **Everything new is OFF as shipped:** the tab loads from Shopify directly (`SO_COPY.mode = 'direct'`), the shared
> copy is off (`SO_COPY.shared = false`), and the five-minute timer is not installed (`shopCacheInstall()` is never run
> by the build). Push the script before the app: the app copes with the old script (it notices an answer with no
> `mode` and falls back to the old wide date range), but it is only fast once the script is new.

## 0. What was built (15 Oct)

| Where | What |
|---|---|
| `Pricing-API/Shopify.gs` | `shopifyOrders_` asks three ways: **by date** (with "Not yet shipped", Shopify filters: `fulfillment_status=unfulfilled`), **by id** (`ids=`, 250 a request), **changed since** (`since=` → `updated_at_min`, every status, nothing trimmed, a voided order comes back as `{id, gone}`; `next=` continues a run that ran out of time). `customer` no longer asked for. Every order carries `upd` (Shopify's `updated_at`); every answer carries `cursor` = the earlier of Shopify's own clock (`Date` header of its first reply) and the newest `updated_at` it sent. Photo pass only when asked. New `shopifyPhotos_` and `shopifyOrderIds_`. `shopifyGet_` also returns the `Date` header. |
| `Pricing-API/Mcf.gs` | `shopifyAttachImages_` split: the lookup is now `shopifyPhotoMap_` (variant photo first, as before). |
| `Pricing-API/Code.gs` | `?shopify=orders` takes `since`, `next`, `ids`, `nophoto=1`; new `?shopify=photos&pids=` and `?shopify=orderIds&start&end`. A call without the new parameters behaves exactly as before. |
| `src/app/shopify/shopify-copy.js` (new) | The device copy: merge, overlap, prune, strip, version, IndexedDB, shadow, the three modes, photos, the safety nets. |
| `src/app/shopify/shopify-orders.js` | 14-day default window; old unfinished orders by id; the three Firestore reads in parallel; photos after the orders; copy / shadow wiring; `fetchShopOrders({ live: true })` for the fall-back. |
| `src/index.html` | "Load from Shopify directly" tick (ticked = today's way) and the age label `soAge` on the Orders toolbar. |
| `src/app/core/auth.js` | Sign out wipes the copy before signing out. |
| `src/app/replenishment/india-usa-express.js` | After the MCF Fulfil write-back, the copy is updated at once (`soCopyTouch`). |
| `src/app/shopify/orders-to-make.js` | A production row keeps its photo when the order's photo has not landed yet (photos now come after the orders, and the sync must not blank and rewrite rows). |
| `tests/shopify-copy-test.js` (new) + `package.json` `check` | 78 checks; nothing reaches Shopify, Apps Script or Firestore. |

**How to try it on one device (local copy only):** in the console `soCopySetMode('shadow')` (or `'copy'`, or untick
"Load from Shopify directly"); `soCopyReport()` shows every shadow comparison and every sync on that device;
`soCopySetMode('direct')` goes back. Shipped setting: `direct`.

### What differs from the plan as written

- **Old unfinished orders**: the list is the one the sync already uses (`shpUnseen`): open SHP production lines and
  open adjustments, by Shopify id. A production line with **no** Shopify id can only be found by date, so for that one
  the dates still stretch back to it (the old way). The 150-day cap is kept. `shpOldestOpen` is no longer called (its
  tests still run). **The list now shows fewer old shipped orders** — widen the dates to see them.
- **Photos** are keyed by Shopify variant / product id, not SKU — the variant's own photo must keep winning (Mcf.gs).
  The production sync now waits for them after a fetch.
- **Cursor** = earlier of Shopify's reply time and the newest `updated_at` (the plan said newest `updated_at` only);
  the earlier one is what makes a change during a long paged read impossible to skip.
- **A full fetch replaces the copy, it is never merged into it** — so the cursor is honest for every order held. Only
  "changed since", the missing old ids and the count check merge.
- **Customer details**: shipped *and cancelled* orders lose name, company, street, city, zip, phone and email; state
  and country stay (the delivery-days and MCF columns read them).
- **Copy also wiped** when another account signs in on the browser, and when "Load from Shopify directly" is ticked.
- **Shadow log** is kept on the device (localStorage `soCopyLog`, last 50, plus the console), not in `pt_syncAudit`
  like delta-sync — that would be a live write. To judge "a week of zero differences" across devices it may be worth
  sending it to `pt_syncAudit/shopify` once Ravi agrees.
- **Own actions**: only the MCF Fulfil write-back exists in the local code. "In progress" and the scan-to-pack
  tracking live only on the live site (see the 12 Oct note); they need the same one-line `soCopyTouch` call when they
  come back into the local copy.
- **Count check** (Phase 4) runs on the device, about once a day, over the 14-day window, and only for a copy that
  holds every order (not a "Not yet shipped" one).
- One record per store holds all its orders, so each sync rewrites that record (a few MB). Fine at today's volume.

**Goal:** the Shopify → Orders tab opens in about 1 second instead of 20–60, at **₹0 a month**, without ever showing an
order list that is wrong without saying so.

---

## 1. Where we are today

- **Orders are not stored anywhere.** Every open asks Shopify live:
  browser → Pricing-API Apps Script (`prGet`, core/backend.js:121) → Shopify REST → back.
- **Only our own additions are stored**, in Firestore: notes and status `audit/shoporders`, bins/HS/GST `audit/skumeta`,
  Amazon stock `stock/SP` and `stock/CPC`.
- **Why it is slow** (read from the code; not yet timed):
  1. The date range reaches back to the **oldest unfinished order** — today 9 Aug, about 10 weeks, roughly 4,600 orders
     (shopify-orders.js:1117).
  2. Shopify gives 250 orders per call, and the script asks **one page after another** (Shopify.gs:202).
  3. "Open only" still downloads **everything**, then throws the shipped ones away (Shopify.gs:225).
  4. A second round of calls for **product photos** (Mcf.gs:343), then one more for the store timezone.
  5. A reply of several MB, which Apps Script is slow to send back.
  6. Three Firestore reads **one after another** before Shopify is even asked (shopify-orders.js:1161-1163).
  7. Leave the tab for **2 minutes** and the whole thing runs again (shopify-orders.js:1092).

## 2. What was decided, and why

| Option | Speed | Cost / month | Decision |
|---|---|---|---|
| Keep fetching live, tidy it up | Several times faster | ₹0 | **Yes — Phase 0** |
| Copy on each device (IndexedDB), fetch only changes | Under 1 s on reopen | ₹0 | **Yes — Phase 2** |
| Shared copy in Firestore, kept up to date by a timer | 1–2 s, even on a new device | ₹0 inside free limits | **Yes — Phase 3, only if needed** |
| Firebase SQL Connect (Postgres) | ~1 s, good for reports | ~₹850–1,000 + Blaze plan | **No** — cost, and a second database to look after |
| Shopify webhooks (instant) | Instant | Needs Blaze (Cloud Functions) | **No** — not ₹0; the 5-minute timer + Refresh is enough |

**Rule that never changes: Shopify is the master.** Every copy is only a copy. If they disagree, Shopify wins on the
next sync. Our own notes, bins and status are never overwritten by a sync.

## 3. The finished design

```
 SHOPIFY (master — Ridhi + CPC)
    │  every 5 min, working hours, + Refresh button: "orders CHANGED since <time>?"
    ▼
 SYNC JOB  (Pricing-API Apps Script timer — already holds both Shopify tokens)
    │  writes only the changed orders; logs every run; emails Ravi after 3 failures
    ▼
 FIRESTORE  shopify_cache/
    ├─ open orders    (small, changes often)
    ├─ closed orders  (in chunks, rarely changes)
    └─ contents page  (last sync time, counts — written LAST, so a reader never sees half a save)
    │  every open screen LISTENS to the contents page only
    ▼
 EACH DEVICE  (IndexedDB copy)
    open → show the copy at once → read only the chunks that changed → redraw
```

The chunk-then-contents-page pattern is the same one the app's replenishment snapshot already uses.

---

## 4. The phases

Each phase is useful on its own. **Measure after each one, and stop as soon as the screen is fast enough.**

### Before Phase 0 — measure today (needs Ravi's OK: it reads live Shopify)

> **Measured 16 Oct ~11:45 IST** (Ravi's OK; read-only, from a browser tab, the live script as it is — photos included),
> both stores at once as the tab asks:
> - **Today's range, 09-08 → 17-10:** Ridhi 3,896 orders / 4.17 MB in 32.0 s, CPC 1,791 / 1.74 MB in 8.3 s →
>   **32.1 s before the list can show.**
> - **The new 14-day window, 02-10 → 17-10:** Ridhi 820 / 0.85 MB in 9.8 s, CPC 457 / 0.43 MB in 5.7 s → **9.8 s.**
> - Not yet measurable: the old unfinished orders by id (a call or two a store), photos left out of the request, and no
>   `customer` field — they need the new script. A reopen in copy mode asks only for what changed (a few orders).
- Time each step once: the Firestore reads, each Shopify page, the photo pass, total.
- Count the orders in today's window per store.
- This is the "before" figure every later phase is compared to.

### Phase 0 — quick fixes, nothing stored (≈ 2 days)
1. **Shorter window:** open with the last **14 days**, plus the old unfinished orders fetched **by order ID**,
   not by widening the whole date range.
2. **Let Shopify filter:** with "open only" on, send `fulfillment_status=unfulfilled` in the request.
3. **Lighter request:** drop the `customer` field (email, phone and address are already taken separately).
4. **Photos later:** take the photo pass out of the orders request; load a SKU → photo list after the orders show.
5. **Parallel start-up:** read notes, bins and stock at the same time.
6. **Old-order clean-up (business task, not code):** close or clear the open order-book lines from August so the window
   stops being pulled back.

*Done when:* the same orders appear as today (checked side by side), and the open time is measured.

### Phase 1 — "changed since" request (≈ 1 day)
- New mode on `?shopify=orders` (Code.gs:178): asks Shopify by **`updated_at_min`**, so refunds, cancellations, edits and
  tracking on *old* orders come through too.
- Returns each order's `updated_at`, and the **newest `updated_at` Shopify sent** as the next starting point —
  Shopify's clock, never the device's or the script's.
- Both stores (Ridhi and CPC).

### Phase 2 — copy on each device (≈ 3–4 days)
- **Open:** show the IndexedDB copy at once, then fetch "changed since" in the background and merge by order ID.
- **Overlap:** always ask from **5 minutes before** the last sync, so nothing slips between two runs.
- **Own actions:** after Fulfil / tracking / In progress, update the copy straight away.
- **Housekeeping:** remove finished orders older than 90 days; a **version number** that throws old copies away when the
  format changes; ask the browser to keep the data (`navigator.storage.persist()`).
- **Customer data:** wipe on **Sign out**; expire after **7 days** unused; shipped orders keep no name, address or phone.
- **Shadow first (same as delta-sync.js):** for the first days the copy is built and **compared silently** with the live
  fetch; every difference is logged. It is switched on only after several days of **zero differences**.
- **Switch back:** a setting "Load from Shopify directly" returns to today's behaviour in one click.

*Done when:* reopen is under 1 second, shadow shows zero differences for a week.

### Phase 3 — shared copy in Firestore (≈ 4–5 days) — only if Phase 2 is not enough
Do this only if first-time opens or devices being out of step are a real problem.

> **Built (15 Oct, late) — both checks passed first, measured read-only in the consoles at about 17:40 IST:**
> 1. **Firestore reads:** 151k in the last 30 days — about 5k a day, peak about 9k (about 18% of 50,000). Writes about
>    240 a day, peak about 900. Last 24 h: 7.1k reads, 258 writes. Far under the 60% line. (The project is on the
>    **Blaze** plan; the free quotas still apply first.)
> 2. **Apps Script run time:** one trigger, `nightlyTick`, every 10 minutes all day: **160 minutes in the last 24 h**
>    (144 runs: about 30 s each, plus a 05:05–08:15 burst of 4–10-minute runs worth 95 minutes). That is already
>    above the free-Gmail 90 minutes and every run completed, so the account works under the 6-hour limit — 44% used.
>    This job adds about 168 runs of a few seconds: roughly 30–50 minutes a day. (The Google account page did not say
>    "managed by thefabricrush.com"; the run time is the proof that matters.)
>
> **Signing in to Firestore (Ravi, 15 Oct): the script owner's own token, no key file.** `ScriptApp.getOAuthToken()`
> with the datastore scope added to `Pricing-API/appsscript.json`. The manifest now lists its scopes explicitly, so it
> carries all seven the project uses today (read from its Overview page) plus `datastore` — a scope left off would
> break a running feature, and a test checks all eight are there. The script runs as ravi@thefabricrush.com, who owns
> the Firebase project, so **no access has to be granted**; Google asks once, on the first run after the push, to allow
> the new scope.
>
> **What was built:** `Pricing-API/ShopifyCache.gs` (the job), `?shopify=cacheSync` (Code.gs), the shared-copy reader in
> `shopify-copy.js` (`soCopyFromShared`, `soSharedListen`), `onSnapshot` added to the Firestore import (core/setup.js),
> and the read rule in `Pricing-App/firestore.rules`. Differences from the list below:
> - **Chunks are one document per store per DAY PLACED** (`shopify_cache_days/SP_2026-10-14`), not open / closed:
>   about 65 orders, ~100 KB a day; a week would come close to Firestore's 1 MB. A sync writes only the days its changes
>   fall on; a device re-reads only the days whose time moved on the contents page (`shopify_cache/meta`). Orders are
>   stored as one JSON string per document. A day over 900 KB is refused out loud, never cut short.
> - **The first fill is 30 days.** A device whose window reaches further back, a shared copy over 30 minutes old, or a
>   missing / other-format one → that device asks Shopify itself, as in phase 2. Old unfinished orders by id are still
>   asked of Shopify by each device.
> - **The rule is in `Pricing-App/firestore.rules`** (the source; `rules-tool.js` is for the Realtime Database rules).
>   Read: the people who can open the orders (`shop`, `adj`, `audit`, or a Shopify section of Replenishment). Write:
>   nobody — the job's owner token is not governed by the rules. That file also carries another session's uncommitted
>   14 Oct edits; deploying it deploys those too.
> - **"Skipped while the nightly runs"** = the job takes the script lock with `tryLock(0)` and skips when `nightlyTick`
>   holds it (they share the lock). A sync holding the lock makes one nightly tick skip; the next runs 10 minutes later.
> - **Customer details** leave shipped / cancelled orders and every order over 60 days old; the 60-day pass and the
>   90-day clean-up run once a day.
> - The shared copy is used only in copy mode with `localStorage soCopyShared = '1'` (or `SO_COPY.shared = true`).

**Two checks first (stop if either fails):**
1. **Firestore reads today.** The ERP has hit the free limit before. Measure the daily reads; if already above about 60%
   of 50,000, do not add Phase 3.
2. **Apps Script run time.** The Sellora nightly runs in the same Pricing-API project. Measure the daily trigger time;
   confirm whether the account is Google Workspace (6 h/day) or free Gmail (90 min/day).

**Then:**
- Timer job every **5 minutes, 8 AM–10 PM IST**, and skipped while the Sellora nightly is running.
- Writes changed orders into **open** and **closed** chunks, then the **contents page last**.
- Screens listen to the contents page and re-read only the chunks whose time moved.
- A new device or private window loads from Firestore (1–2 s), never from Shopify.
- The Refresh button asks the job to sync **now** (about 3 seconds).
- Opening the screen starts a sync if the last one is older than 2 minutes.
- **Security rules:** only Shopify-team logins may read `shopify_cache`. Rules change only through the rules source and
  `rules-tool.js`, never the generated file by hand.
- **Budget guard:** the job counts its own writes; near a ceiling (e.g. 5,000 a day) it slows to every 30 minutes rather
  than use up the quota.
- Remove customer details from orders older than **60 days** in the shared copy.

### Phase 4 — safety nets (≈ 2 days)

> **Built (15 Oct).** Device: the age label (grey / orange 15 min / red 30 min, `soAge` on the toolbar), the auto
> fall-back (a device copy over 30 minutes old that cannot be updated, or a shared copy over 30 minutes old → loaded
> from Shopify, and the screen says so), the device sync log (`soCopySyncLog`, last 100, in `soCopyReport()`), and a
> daily count check per device. Script (ShopifyCache.gs): one email after 3 failed syncs in a row (to Script Property
> `SHOP_CACHE_ALERT_TO`, else the owner — question 2 below is still open), the sync log on the contents page (last 20
> runs), and a daily count check of the shared copy (`shopifyOrderIds_`, last 30 days: a day whose ids differ is loaded
> again whole — the only way an order deleted on Shopify leaves). Tests for all of it, including the version guard.
- **Age on screen:** "Updated 4 min ago" — grey, **orange after 15 min, red after 30**.
- **Auto fall-back:** if the last sync is older than 30 minutes, the page fetches live from Shopify like today —
  slow, but never wrong without saying so.
- **Email alert:** 3 failed syncs in a row → one email to Ravi (free from Apps Script).
- **Sync log:** every run records time, store, orders, writes, error.
- **Nightly count check:** compare orders per day, Shopify vs. copy; reload any day that does not match. Catches deleted
  orders within 24 hours.
- **Tests** in `npm run check` for merge, overlap, clean-up, customer-data stripping, and a test that fails if the order
  format changes without the version number changing.

### Phase 5 — side by side, then switch (1 week)

> **The check is built; the week needs the live app.** Shadow mode now also builds the shared copy afresh from
> Firestore and compares it with what Shopify just said (`soCopyReport().sharedDifferences`); a change made after the
> shared copy's last sync is counted as `behind` (by design, up to 5 minutes), not as a fault.
>
> **Runbook — every step needs Ravi's go-ahead; none has been done:**
> 1. **Live is ahead of this folder.** On 15 Oct the live site held code that is on neither GitHub nor this PC (Fabric
>    master, Greige Desk links; Scan to pack / Pack & verify). Deploying this folder as it is would REMOVE that work.
>    First bring the live-only code into `src/`, then compare a fresh `dist` with the live `index.html`.
> 2. **Apps Script:** `clasp pull` into a scratch folder and compare with `Pricing-API/` (the live script was last
>    changed 10 Oct); then `clasp push`. The web app runs a **versioned** deployment (Version 158), so a push alone
>    changes nothing for the app — the deployment has to be moved to the new version.
> 3. Open the script once and run `shopCacheInstall()`: Google asks for the new Firestore permission; allow it. The first
>    run fills 30 days of both stores. Optional: set `SHOP_CACHE_ALERT_TO`.
> 4. Deploy the Firestore rules from Pricing-App (`firebase deploy --only firestore:rules`), with the 14 Oct edits in that
>    file agreed first.
> 5. `node tests/build-dist.js`, then deploy hosting. Everything is still OFF: every screen loads as before.
> 6. **The week:** on 2–3 devices, in the console: `soCopySetMode('shadow')` and `localStorage.soCopyShared = '1'`. Each
>    day, `soCopyReport()` on each: `differences` (device copy) and `sharedDifferences` (shared copy) must stay 0; the
>    contents page log (`shopify_cache/meta`) shows every sync and the daily count check.
> 7. **Switch** after a week of zeros: untick "Load from Shopify directly" on those devices, then set
>    `SO_COPY.mode = 'copy'` and `SO_COPY.shared = true` for everyone. Keep the tick for a month.
> 8. **Back out at any moment:** tick "Load from Shopify directly" (or `soCopySetMode('direct')`); `shopCacheRemove()`
>    stops the timer. Nothing the copy does touches notes, bins, status or production.
- Old and new run together; compare counts and statuses with Shopify every day.
- Switch over only on Ravi's go-ahead. Keep "Load from Shopify directly" available for a month afterwards.

---

## 5. Drawbacks, and how each is handled

| Drawback | How it is handled | What is left |
|---|---|---|
| More code, more parts | One module; switch back to today's path; tests; phases only when needed | Some upkeep |
| Old data shown quietly | Age colours, auto fall-back to live, email alert, sync log | None — it always says so |
| Missed changes | 5-min overlap, Shopify's own clock, own actions saved at once, nightly count check | Fixed within 24 h at worst |
| Shared free limits | Measure first, open/closed chunks, listen to one doc, budget guard, working hours only | Paid plan only if the business grows a lot |
| Customer data stored | Only unshipped orders keep it; wipe on sign-out; 7-day expiry; 60-day clean-up; role rules | **Small risk** — a stolen, signed-in device shows that day's orders (as today) |
| Up to 10 min behind | Every 5 min, Refresh button, sync on open | **Not instant** — that needs the paid plan |
| Browser deletes the copy | `storage.persist()`; falls back to Firestore in 1–2 s | Negligible |
| Changes take more care | One version number, enforced by a test | None |

## 6. What it costs

| Item | Expected use | Free limit | Cost |
|---|---|---|---|
| Firestore reads | Low hundreds a day | 50,000 / day | ₹0 |
| Firestore writes | ~1,000 a day (5-min sync, 2 stores, working hours) | 20,000 / day | ₹0 |
| Firestore storage | ~20 MB | 1 GB | ₹0 |
| Apps Script timer | ~20–40 min a day | 90 min (Gmail) / 6 h (Workspace) | ₹0 — **check** |
| Shopify API | Far fewer calls than today | — | ₹0 |
| Device storage | 15–20 MB per device | Browser | ₹0 |

**₹0 as long as it stays inside the free limits** — the two checks before Phase 3 confirm that.

## 7. Time

| Phase | Work |
|---|---|
| Measure today | ½ day |
| 0 — quick fixes | ~2 days |
| 1 — changed since | ~1 day |
| 2 — device copy (+ shadow week) | ~3–4 days + 1 week shadow |
| 3 — shared Firestore copy | ~4–5 days (only if needed) |
| 4 — safety nets | ~2 days |
| 5 — side by side | 1 week |
| **Total** | **about 3–4 weeks**, or about 1 week if Phase 0 is enough |

## 8. Ground rules

- Local first. No deploy, no push to Apps Script, no commit, no live write without Ravi's go-ahead.
- Ask before any read of live Shopify or live Firestore.
- Live can be ahead of GitHub — compare before deploying.
- Database rules only through the rules source and `rules-tool.js`.

## 9. Questions for Ravi

1. Is the Google account that runs Pricing-API on **Workspace** or **free Gmail**? (Sets the Apps Script limit.)
2. Who gets the **sync-failure email**?
3. Working hours for the sync — **8 AM–10 PM IST** OK?
4. Default window — **14 days** OK, or 7?
5. Which logins count as the **Shopify team** for the read rule?
6. Can the old August open lines be closed, so the window stops reaching back?
