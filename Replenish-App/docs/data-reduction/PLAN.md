# Ridhi App — Data Download Reduction Plan

Nov 5, 2026 · @Ravi

## Summary

We can cut the app's database download by roughly 70–85%, in small steps, each behind an off-switch and each tested on a preview first. No screen changes what it shows; only when and how much data is fetched changes.

> **The problem:** the database download went from 2.4–3 GB/day (Oct) to 5–8 GB/day (now). Firebase Realtime Database charges about $1/GB after the free 10 GB/month and does not compress, so the bill can reach roughly ₹12–19k/month at today's rate (estimate; confirm on the billing page).
>
> **The cause:** data is fetched because a user has access to something, not because they are using it. The order ticker pulls ~11 MB on every page, login pulls whole lists only to show badge counts, and every factory page pulls all 8 big registers even when it needs 2–3.
>
> **The fix, in order:** (0) billing safety and a built-in data meter, (1) ticker and badges ask the database only for pending items, (2) old closed orders move to an archive, (3) each page loads only its own registers, (4) fix the change notes, then Delta Sync phase 3, (5) tabs share one copy of the data, (6) optional: split the code file per page.
>
> **What does not change:** the screens, the numbers on them, the permissions, the database rules, and the data itself. Every step can be switched off on one device or for everybody without a deploy.
>
> **Honest limit:** no change is risk-free. This plan makes every risk visible before users see it (shadow checks, preview, tests) and reversible in seconds (switches).

**Target:** database download at or below 1.5 GB/day (proposed; Ravi to confirm). Once the meter shows the target held for 2 weeks, the remaining optional steps are dropped.

## Start here — the final plan

This is the agreed order of work (5 Nov 2026). The sections below explain each step in detail; this list is what to execute.

**Today (Ravi)**

- Google Cloud billing: "Suspicious activity" / payments issue → Fix now
- Budget alert at ₹3,000/month (50%, 90%, 100%)
- Confirm the target: 1.5 GB/day, or name another number
- Send the developer (laptop) session: "Build the data meter behind a switch. Check whether orders carry a status field, and how many closed orders are older than 90 days. Send a preview link."

**Week 1 — Protect and measure**

- Cloud Monitoring alert on database download bytes
- Data meter live (page × register × MB per day, tabs, reloads)
- Checks: status field present? closed orders older than 90 days? tabs per user?

**Week 2 — Read less**

- `isPending` field, written by one shared function, plus `.indexOn`; one-time script fills old orders; nightly check fixes any mismatch
- Ticker and badges use the pending query (switch `pendingQueries`)
- `ptOrdersAll()` for every history screen; archive dry run starts (30 days, logs any closed order a screen still opens)
- Vendor `pt_sync` rule (tight: own rows, server timestamp only), then atomic change notes
- Sample and explain Master's ~70 mismatched rows

**Weeks 3–4 — Load less**

- Each page loads only its registers, one page group at a time (static test + runtime guard)
- Move closed orders older than 90 days to the archive, one month at a time; search offers "include archive" for one order
- Logout deletes the browser copy on shared PCs only

**Weeks 4–6 — Delta Sync**

- Shadow: 0 mismatches for 4 consecutive working days
- Ravi's PC for 3 days → everybody

**Then — decide by the meter**

- Target met for 2 weeks → stop here.
- Target not met → add, in this order: idle prefetch of the 1–2 most-opened pages (desktop only), shared tabs with `navigator.locks` (falls back to one copy per tab), Cloud Function change log with a running sync ID.

## Not doing now (and why)

| Idea | Reason |
| --- | --- |
| Paging in big lists (first 100 rows) | Breaks every screen that totals, filters or exports the full list |
| Showing old data first on entry screens (stale-while-revalidate) | Someone could save based on an old number; allowed only on view-only screens with an "updating…" mark |
| Fetching changed rows over WebSocket instead of REST | Small saving for the code risk |
| Splitting the code file per page | Touches every page; small saving, only after deploys |
| Moving to Supabase / SQL | Weeks of work; the bill problem is solved without it (see "Is this the best plan") |

## Where the data goes today

Most of the download is triggered by access rights and by one shared loader, not by what the user opens. Each row below was checked in the code of ravikumar7357/ridhi-apps (Replenish-App) on 5 Nov 2026.

| What is downloaded | When | Size | Needed? | Where in code |
| --- | --- | --- | --- | --- |
| 8 gate registers: Order Book, Master, QC checks, Cutting, Press, Shopify production, Masters, Cutting freezes | Any factory page, and every page via the ticker 4 s after login if the user has Orders access | ~11 MB | Ticker needs only a count + top list; most pages need 2–3 registers | `orders/order-ticker.js:65`, `core/gates.js` (`ptLoadGates`) |
| Whole lists only to show badge numbers: vendor requests, RFD decisions, Sales Orders, FG corrections, Job Work corrections, Amazon listings, POs | At login, for every tab in the user's access | Not measured | No: a number is enough until the page is opened | `core/auth.js:259-273` |
| The app code: one file with every page | Each open; only re-downloaded after a deploy (304 otherwise) | 5.9 MB raw, ~1.76 MB zipped | Partly: a user only uses a few pages | `public/index.html`, `firebase.json` no-cache |
| Whole database export for the nightly backup | 03:15 IST daily | Not measured (whole DB) | Yes, but it grows with log nodes | `Backup-Script/Code.gs:56` |
| Same register again in a new tab, after reload, after a deploy | Every time | Full size again | No: data was already in the browser | live copies are per tab (`core/live-copies.js`) |

**Already good:** inside one tab, a register downloaded once stays live, so moving between pages does not re-download it.

**Why Delta Sync phase 3 is not safe yet (found in code):**

1. **Vendors cannot write the change note.** The database rule for `pt_sync` refuses any vendor account (`!pt_vendorByEmail...` in `Pricing-App/database.rules.next.json:255`). When a vendor-portal user saves a row in a synced register, the row changes but no note is written. This fits the Order Book and Cutting mismatches.

2. **The note is a second, separate write.** `ptSyncNote` (`core/history.js:96`) fires after the save and is never awaited. If the tab closes or the network drops between the two writes, the row changes with no note.

3. **Master's ~70 rows on every check is a steady pattern, not random edits.** Not yet explained: either one writer rewrites the same rows, or the two reads return the same data in a different form (number vs text, list vs object). A sample of those rows decides which.

4. **Phase 3's own safety net has a gap:** the copy's timestamp moves forward on every delta open (`core/delta-sync.js:238`), so a PC opened daily never takes the "copy older than a day → full download" path. A row changed without a note would stay wrong on that PC indefinitely.

## Rules every step follows

These eight rules are what make the plan safe. A step that cannot meet all of them does not ship.

1. **One switch per step.** A flag in the Firestore config doc (already read at login in `core/auth.js`), so it changes for everybody without a deploy, plus a per-device `localStorage` override (`=1` on, `=0` off), the same pattern Delta Sync already uses. Rollback = flip the flag; no data migration to undo.

   > **What it means:** the new code and the old code both stay in the app. The switch only chooses which one runs. Nothing is deleted until the new way has run cleanly for weeks.
   >
   > **Example:** if the ticker summary shows a wrong count on Monday, `tickerSummary` is set off. Within one page reload everybody is back on today's ticker, and no data has to be repaired.
   >
   > **Why per device:** Ravi's PC can try a step for 2–3 days while everybody else stays on the old way.

2. **Shadow before use.** Where a new way of reading replaces an old one, it first runs alongside the old way and logs any difference. It only takes over after an agreed number of clean days.

   > **What it means:** users keep seeing data from the old way. In the background, the new way computes the same answer and a log records whether the two match.
   >
   > **Example:** Delta Sync phase 2 has done this since 10 Oct. That is how the Master, Order Book and Cutting mismatches were found without any user ever seeing wrong data.
   >
   > **Rule:** "clean" means zero mismatches, not "few". One unexplained mismatch resets the count.

3. **Fail to today's behaviour.** Any doubt (missing data, an error, a stale copy, a denied read) falls back to the current full download. Slower, never wrong.

   > **What it means:** every new shortcut has an exit back to the old full read, and doubt always takes the exit.
   >
   > **Example:** the browser copy is missing, a changed row cannot be read, or 300+ rows changed → the page downloads the whole register like today. The worst case is about half a second slower, never older data.
   >
   > **Also logged:** each fallback writes its reason, so a rising number of fallbacks shows a hidden problem early.

4. **Correct first, cheap second.** No step may show a user an older or different number than today. Where a summary or count can lag, the full page data is still read when the page opens, and the page's own numbers win.

   > **What it means:** saving money is never allowed to cost a wrong number on a screen where someone makes a decision.
   >
   > **Example:** a badge says 5 vendor requests. When the page opens it reads the real list; if there are 6, the page shows 6, fixes the badge and logs the gap.
   >
   > Small summaries say their age: the ticker shows "as of 14:05" and hides itself if older than 2 hours.

5. **Writes stay atomic.** Any summary, count or change note is written in the same database update as the data it describes, never as a follow-up write.

   > **What it means:** "atomic" = both parts save together, or neither saves. There is no moment where one is saved and the other is not.
   >
   > **Example of the bug this prevents:** today the row is saved first and the `pt_sync` note is sent afterwards. If the tab closes in between, the row changed with no note, and Delta Sync can never learn about it.
   >
   > **Watch-out:** if the database rule refuses any one part, the whole save is refused. So rules are always deployed before the code that writes the new part.

6. **Tests with teeth.** Each step adds a test, plus a "teeth" test that breaks the step on purpose and proves the suite fails (the repo already does this for Delta Sync).

   > **What it means:** a normal test checks the code works. A teeth test checks the test itself would notice if the code broke.
   >
   > **Example:** the teeth test changes the ticker count by one on purpose. If the test suite still passes, the test is useless and is rewritten before the step ships.
   >
   > **Gate:** `npm run check` and all tests pass before every preview and every deploy. The switch-off path is tested too, not only the on path.

7. **Preview, then one device, then everybody.** Preview link checked by Ravi → Ravi's PC for 2–3 working days → all users.

   > **Preview:** a separate link with the change, real data, no effect on the live app. Ravi opens the changed screens and compares them with live.
   >
   > **One device:** the switch is on only on Ravi's PC, during real work. Problems hit one person who knows a test is running.
   >
   > **Everybody:** only after Ravi says yes. The switch stays in the code for at least 2 weeks after, for instant rollback.

8. **Measure before and after.** Every step states its expected MB saved, and the claim is checked against real numbers, not estimates, before the next step starts.

   > **What it means:** the Step 0 baseline table is the "before". After each step, the same users and pages are measured again.
   >
   > **Example:** Step 1 expects ~11 MB less per non-factory page. If the real saving is 2 MB, the next step waits until we know why.
   >
   > **Why:** earlier estimates in chat changed from 90% to 55–60% once real numbers were read. Only measured numbers decide what comes next.

## Step 0 — Safety and baseline (today, no code risk)

Fix the billing account first: if payment stops, the whole app stops, and no code change matters.

- Google Cloud billing: open "Suspicious activity detected" / "issues with your payments account" and complete Fix now (Ravi, today).
- Budget alerts on the Firebase project `price-research-48ff3`: emails at 50%, 90% and 100% of ₹3,000/month (Ravi, in Google Cloud Billing → Budgets & alerts).
- Cloud Monitoring alert on Realtime Database download bytes, so a spike emails Ravi the same day instead of waiting for someone to open the usage page.
- Read the real bill for Oct and Nov so far, split by product (Realtime Database download vs Hosting vs Firestore). This replaces every estimate in this plan.
- Built-in data meter (code, behind a switch): every database read in the app (`ptGet`, `ptLoadGates`, the live copies) adds its size to a per-tab tally of page × node × MB. Once a day each user writes one small line: user type, pages, MB per node, number of tabs and reloads. This is the baseline now and the "after" for every later step (Rule 8).
- Look inside the 8 registers: how many Order Book rows are closed and older than 90 days, and what share of the 4.5 MB they are. Decides Step 2.
- Check the data shape for Step 1: does each order / request carry a `status` field the database can filter on?
- Size the nightly backup export and the `pt_syncAudit` log (it grows every day and is inside that export).

**Done when:** billing shows no warning, alerts are set, and the data meter has 3 working days of data. Every later step is judged against those numbers.

## Steps 1–6

Order = biggest saving for least new code first. Prefer reading less over writing new data. All savings are estimates until the Step 0 meter confirms them; if the meter shows a different biggest cost (for example reloads and extra tabs), the order changes to match.

### Step 1 — Ticker and badges ask only for pending items (est. ~11 MB → well under 1 MB on non-factory pages)

- **First choice, a database query:** the database filters on the server: `orderByChild('status').equalTo('pending')` plus an `.indexOn` rule. Only matching rows travel. No new nodes, no new writers, so nothing can drift out of date.
- **Ticker:** if the page already holds the registers, count from them (free). Otherwise run the pending query on Order Book. **Badges:** the same query on each badge list (vendor requests, RFD, Sales Orders, corrections).
- **Only if the data shape does not allow a query** (checked in Step 0): fall back to a small summary node, written with a server timestamp inside a transaction so two browsers cannot overwrite each other, and counts changed with `increment`. The page recounts from the full list when opened and corrects any drift.
- **Correctness:** if a summary is used, the ticker shows "as of 14:05" and hides itself if older than 2 hours (nights and Sundays included: Ravi to confirm that hiding is acceptable then).
- **Security:** `.indexOn` and any new node go through the rules builder (`Pricing-App/rules/build-rules.js`); reads stay limited to people with Orders access.
- **Tests:** query result equals a count from full data on fixtures; teeth test breaks the filter; switch-off path tested.
- **Rollback:** switch `pendingQueries` off → today's full loads.

> **How the query is made safe:** each order gets an `isPending` true/false field, set by one shared function from the order's status, never by hand. A one-time script fills it for existing orders, a test checks after every save that the field matches the status, and a nightly check corrects any row that drifted. **Leftover cost:** the ticker still listens to pending orders, so a little data flows as they change (far below ~11 MB).

### Step 2 — Move old closed orders to an archive (saving decided by the Step 0 count)

- **Change:** Order Book rows closed more than 90 days ago move to `pt_orderArchive`, in one atomic update per batch (removed from one, written to the other in the same write). Every read of Order Book, every new tab, the Delta first load and the nightly backup get smaller for good.
- **Risk:** screens and reports that show history must read the archive too. `read-map.json` lists them; each is changed and tested before the first move.
- **Safety:** the first run is a dry run that only counts; then one month at a time; the nightly backup before each run is checked.
- **Rollback:** a script moves archived rows back; the archive is never deleted.

> **How the archive is made safe:** every screen that shows history reads through one function, `ptOrdersAll()`, which adds the archive only when the user picks an older date. A test fails if any screen reads history straight from `pt_orderBook`. For the first 30 days the archive only runs dry: any closed order a screen still opens is logged. Search offers "include archive" and then fetches just that one order, never the whole archive. **Leftover cost:** history screens are a little slower when they reach into the archive.

### Step 3 — Each page loads only its own registers (est. ~11 MB → 3–6 MB per first page)

- **Change:** `ptLoadGates()` takes a list: `ptLoadGates(['pt_qcChecks','pt_orderBook'])`. Each page declares its list, built from `Pricing-App/rules/read-map.json`. Registers already in the tab are reused, as today.
- **Static check:** a test scans each page's code for every register it touches and fails if one is missing from that page's list.
- **Runtime guard:** a page that asks for an undeclared register gets it loaded on the spot (a short wait, never an empty screen), and an audit line names the page and register.
- **Cost:** the first visit to a page that needs a new register waits 0.5–1 s (estimate).
- **Rollout:** one page group at a time (QC, then Job Work, then Orders…), each through preview.
- **Rollback:** switch `pageRegisters` off → all 8 load as today.

> **Hiding the first-visit wait** (only if the meter shows it matters): after the first page settles, while the browser is idle, load the registers of the 1–2 pages this user opens most (70%+ of days, per the meter). Desktop only, never on phones, so nobody's mobile data is spent on a guess.

### Step 4 — Fix the change notes, then Delta Sync phase 3 (est. ~94% less on reload / new tab for the 8 registers)

1. **4a. Vendor rule, tightly scoped.** Update the `pt_sync` rule so a vendor may write a note only for a row it may write, and only with the server timestamp as value. Deployed before 4b.

2. **4b. Atomic notes.** `ptPut` / `ptPatch` send the data and its `pt_sync` line in one multi-path update.

3. **4c. Option to compare: a server-side note.** A Cloud Function `onWrite` trigger writes the note for every write, from any source (vendor, script, console). Cost (function calls and reads) is not checked yet; measure on preview before choosing it over 4a–4b.

4. **4d. Explain Master's ~70 rows** from a `pt_syncAudit` sample: a format difference is fixed in the comparison, a real writer gets a note.

5. **4e. Close the safety gap.** A separate `fullAt` time, set only by a full download; older than 24 h → full download.

6. **4f. Shared PCs and phones.** Logout deletes the browser copy (IndexedDB) on shared PCs only; a personal PC can keep it, so the next login stays fast. Test the phone storage limit and the browser clearing data on its own: both must fall back to a full download.

7. **4g. Gate:** shadow shows 0 mismatches for 4 consecutive working days → Ravi's PC for 3 days → everybody. After go-live the shadow keeps running on 1 in 10 opens.

8. **4h. Later:** add Finished Goods, Vendor Orders and Sales Orders, each with its own shadow period.

**Rollback:** `DELTA.use` off in the config doc, or `deltaUse=0` on one device.

> **Two limits on Delta:** showing the browser copy first and refreshing behind it is allowed only on view-only screens (dashboard, reports) with an "updating…" mark, never on entry screens. If target is still missed later, the Cloud Function change log gets a running sync ID, so a client sees a gap (it had 1040, then 1043 arrived) and fetches the missing changes, as Linear's sync engine does.

### Step 5 — Tabs share one copy of the data (saving set by the meter's tab count)

- **Change:** one tab holds the database listeners; other tabs of the same user get the data through `BroadcastChannel`. A user with 4 tabs open downloads once, not 4 times.
- **Safety:** if the leading tab closes, another takes over; any doubt → each tab loads on its own as today. Same user and same account only.
- **Rollback:** switch `sharedTabs` off.

> **Leader hand-over:** `navigator.locks` lets the next tab take over at once if the leading tab closes. Browsers without it, and any doubt, fall back to each tab loading its own data as today.

### Step 6 (optional) — Split the code file per page (est. ~1.76 MB → ~0.3–0.5 MB after each deploy)

- **Why optional:** the app is one file assembled from many scripts that share global names, so splitting touches every page, and the saving only happens after a deploy.
- **Decision:** only if the billing split shows Hosting is a real cost and the 1.5 GB/day target is not met. Fewer deploys (next section) get most of this saving for free.

## Deploys and monitoring

Every deploy makes every open tab reload and re-download its registers, so deploys are batched and the plan is watched with numbers.

### Deploys

- Two fixed windows a day: about 13:30 (lunch) and after 19:00, when fewest people are mid-entry.
- A deploy outside a window only for a broken save or wrong data, and it is noted with the reason.
- Before each deploy: `npm run check` (assemble + Shopify copy + Delta tests) and the full test folder pass; the preview link is opened and the changed screens checked.
- After each deploy: one line in a deploy log (time, what changed, which switches moved).

### Monitoring (one small "Data use" card for admins)

| Signal | Source | Alarm |
| --- | --- | --- |
| Download per day | Cloud Monitoring alert + data meter | Above the day's budget share for 2 days |
| Delta mismatches | `pt_syncAudit` | Any mismatch after go-live → switch off, investigate |
| Undeclared register reads (Step 3 guard) | audit line | Any → fix the page's list next release |
| Ticker / badge summary age | `at` field | Older than 2 h during working hours |
| Fallbacks to full download | Delta log mode: full + reason | Rising share = something writes without a note |

`pt_syncAudit` and other logs keep 30 days, then are trimmed, so they do not grow the nightly backup forever.

## Timeline and gates

About 6 weeks if each gate passes first time. A failed gate stops the next phase, not the whole plan: steps already live keep running.

**Rollout — 4 phases, 3 gates** (a text version built from the "Start here" list; the PDF shows this as a chart)

1. **Phase 1 — Protect and measure (Today, Week 1):** billing fix, budget alert, Cloud Monitoring alert, data meter live, and the three checks (status field, closed orders older than 90 days, tabs per user).
   - **Gate 1:** billing shows no warning, alerts are set, and the data meter has 3 working days of data (Step 0, "Done when").
2. **Phase 2 — Read less (Week 2):** `isPending` field and `pendingQueries` for the ticker and badges, `ptOrdersAll()` and the archive dry run, vendor `pt_sync` rule then atomic change notes, Master's ~70 mismatched rows explained.
   - **Gate 2:** the saving is checked against real numbers before the next step starts (Rule 8).
3. **Phase 3 — Load less (Weeks 3–4):** each page loads only its registers, closed orders older than 90 days move to the archive one month at a time, logout clears the browser copy on shared PCs only.
4. **Phase 4 — Delta Sync (Weeks 4–6):** shadow run, then Ravi's PC for 3 days, then everybody.
   - **Gate 3:** 0 mismatches for 4 consecutive working days.

Then decide by the meter: target met for 2 weeks → stop here; otherwise add the optional steps in the order listed under "Start here".

The weeks are a target, not a promise. Gate 3 (4 clean working days) decides when Delta goes live. Work can overlap: the note fixes and the Master check (4a–4d) run beside Steps 1–2 because they touch different code. Step 6 (code split) is outside this timeline and depends on the billing split and the 1.5 GB/day target.

### Owner checklist

- Ravi: billing Fix now and budget alerts (Step 0)
- Ravi: approve each preview link before it goes to Ravi's PC
- Ravi: approve each move from Ravi's PC to everybody
- Developer session: data meter, then Steps 1–5 in order, one switch each
- Developer session: deploy only in the two daily windows, with a deploy log line
- Ravi: confirm the 1.5 GB/day target
- Ravi: decide whether the ticker may hide at night and on Sundays when its summary is old
- Ravi: tell staff before each go-live (the ticker shows "as of", the first visit to a page may wait about a second)

## Is this the best plan?

Yes, for today's data size and team: it gets the biggest saving first, every step can be switched off, and nothing built is wasted if we later move to SQL. It is not a full big-ERP architecture; that needs a different database.

### Alternatives compared

| Option | Why not now |
| --- | --- |
| Do nothing | The bill keeps growing; a payment stop takes the whole app down |
| Move straight to Supabase / SQL | Weeks of work and risk of wrong data; not needed to fix the bill |
| Only Delta Sync phase 3 | Has a data bug today and covers only 8 registers; ticker and badges keep costing |
| Paging everywhere | Big-ERP style, but breaks many screens |

### How big ERPs handle the same problem

| Pattern | Who does it | In this plan |
| --- | --- | --- |
| Load one page of rows, more on scroll | Odoo list views load in batches with a limit ([Cybrosys](https://www.cybrosys.com/blog/how-to-implement-lazy-loading-in-odoo-19), [Odoo issue](https://github.com/odoo/odoo/issues/2235)); SAP Fiori "growing" lists page with `$top` / `$skip` ([SAP blog](https://blogs.sap.com/2018/03/29/how-does-ui5-autogrowing-list-work/)) | Not now (breaks screens) |
| Filter on the server | Every SQL-based ERP | Step 1 (pending query + `.indexOn`) |
| Archive old data | SAP archiving and data aging ([SAP Community](https://groups.community.sap.com/t5/enterprise-resource-planning-blogs-by-sap/sap-s-4hana-data-management/ba-p/13477055), [SAP answers](https://answers.sap.com/questions/12512728/data-aging-in-s4-hana.html)); Odoo archived records | Step 2 |
| Send only changes, numbered so gaps are caught | Linear's sync engine: full bootstrap once, then delta packets with sync IDs, stored in IndexedDB ([study](https://github.com/Aslam97/reverse-linear-sync-engine), [performance.dev](https://performance.dev/what-makes-linear-feel-instant); unofficial sources) | Step 4, and the optional sync ID |
| Live updates only where needed | ERPNext realtime via socket.io, used sparingly ([Frappe docs](https://docs.frappe.io/framework/user/en/basics), [forum](https://discuss.frappe.io/t/real-time-data-at-the-document/33063)) | Step 3 (fewer live registers) |

Firebase bills connection and TLS overhead as well as data, and recommends queries to limit what listeners return ([Firebase billing](https://firebase.google.com/docs/database/usage/billing)).

### When to move to a SQL database (Supabase / Postgres)

- Download stays above the target after this plan
- Live registers (after archiving) pass 20–30 MB
- Reports, totals and multi-field filters become slow in the browser
- Users or vendors grow several times over

Any one of these is the signal to plan the move; until then, this plan is the cheaper and safer path.

## Open questions

These are not yet measured or decided; each is answered in Step 0 or the step that needs it.

- What is the real Oct and Nov bill, split by Realtime Database download, Hosting and Firestore?
- How many MB does each badge list and each page's own data weigh, per user type?
- What are Master's ~70 mismatched rows: a format difference or a real writer?
- Do any vendor-portal saves touch the 8 synced registers today, and how many per day?
- How large is the nightly backup export, and how fast is `pt_syncAudit` growing?
- Prices: Firebase (~$1/GB download, 10 GB/month free) and the Supabase comparison were quoted from memory in the earlier chat; check the official pricing pages before any database decision.
- Supabase migration is out of scope for this plan; revisit only if, after Steps 1–4, the bill or speed is still not acceptable.
- Does each order and request carry a status field the database can filter on (decides Step 1's query vs summary)?
- How many Order Book rows are closed and older than 90 days, and how many MB do they weigh?
- How many tabs does a typical user keep open, and how often do they reload?
- What would a Cloud Function change note (Step 4c) cost per month?
