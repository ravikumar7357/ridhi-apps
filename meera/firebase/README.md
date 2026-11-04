# Meera's search on Firebase Cloud Functions — "never even one cent" (master plan D.2, Ravi 2–3 Nov 2026)

Only on Ravi's "live karo", from the office computer, with the Firebase tool (`C:\Users\User\tools\firebase\firebase.exe`,
signed in as ravi@ — `firebase.exe login --no-localhost --reauth` if it asks). Never from GitHub.

## What goes up (codebase `meera`: nothing else in the project is touched)
| | what | limits |
|---|---|---|
| **meeraSearch** | her search (`meera/functions/service.js`), https://asia-south1-price-research-48ff3.cloudfunctions.net/meeraSearch | Mumbai · at most **2** instances · **none kept warm** · 1 GiB / 1 CPU · **10 s** time-out |
| **meeraCostAlarm** | the cent alarm (`alarm.js`), on the Pub/Sub topic `meera-budget` | at most **1** instance · none warm · 256 MiB · 30 s |
Neither uses Firestore or the Realtime Database (the quota fix is untouched), and neither keeps any question.
Nobody uses meeraSearch until the switch `server` (side by side) or `serveruse` is on.

## The guards, in layers (all tested — meera/functions/test/guards.test.mjs, meera/tests/search-stop.cjs, router tests §11)
1. **Its own meter (works at once).** Every request meeraSearch receives — answered, refused or turned away — is counted
   with its billed time, rounded UP to 0.1 s, and every cold start adds its start-up plus 3 s. Sent to her router every
   20 requests or 15 s. The router keeps the month's totals and **stops her search at half of Google's free monthly
   allowance**:

   | Google's free allowance a month (request-based, read 2 Nov) | half — where it stops |
   |---|---|
   | 2,000,000 requests | **1,000,000 requests** |
   | 180,000 vCPU-seconds | **90,000 CPU-seconds** |
   | 360,000 GiB-seconds | 90,000 CPU-seconds at 1 GiB = 90,000 GiB-seconds (a quarter) |

   When it stops: meeraSearch shuts its own door (ingress "internal only" — Google then refuses outside requests before
   they reach it, unbilled), every browser searches on its own as today (no note to staff), and the admin page says
   **"Server search stopped to stay free — back on the 1st"**. It stays stopped for the rest of the month; on the 1st the
   meter starts again at 0 (the door is opened by deploying again). The limits are `METER_REQ` / `METER_SEC` in
   `meera/router/wrangler.toml`, to lower if the billing account's other use is found to share the allowance (step 4).
   If her router cannot be reached while many requests go uncounted (3 tries, 200 requests), it stops too.
   The daily limit for all staff (**5,000** a day) and the per-person cap (400 a day) stay.
2. **Hard limits** above, and image clean-up: **keep 1 day** (`firebase.exe functions:artifacts:setpolicy --location
   asia-south1 --days 1`, or answer the deploy's question with 1), so stored images stay inside the free 0.5 GB.
3. **The cent alarm.** A Google Cloud budget for the project, with its messages sent to Pub/Sub topic `meera-budget`.
   Each message carries the month's actual cost; on **any cost above 0** meeraCostAlarm turns her router's "Search on the
   server" off (`/alarm`, with its key) and shuts meeraSearch's door. It acts on the cost in every message, not on an
   alert threshold, so the budget amount itself does not matter (₹1 is fine). It touches ONLY her search — there is no
   billing call anywhere in meera/functions (tested). The budget covers the whole project, so a cost from anything else
   in the project also stops her search — on purpose.

## Every cost line (with all guards)
| | most it can use in a month | free allowance | cost |
|---|---|---|---|
| meeraSearch compute | 90,000 CPU-s and 90,000 GiB-s (the meter stops it there) | 180,000 / 360,000 | **$0** |
| meeraSearch requests | 1,000,000 (the meter stops it there) | 2,000,000 | **$0** |
| meeraCostAlarm | ~2,200 messages (one every ~20 min) × ≤0.5 s at 256 MiB ≈ 200 CPU-s, 300 GiB-s, 2,200 requests | same allowance | **$0** |
| Pub/Sub (budget messages) | ~2 MB | 10 GiB | **$0** |
| Eventarc (the alarm's trigger) | ~2,200 events | 50,000 | **$0** |
| Cloud Build (each deploy) | a few minutes | 2,500 minutes | **$0** |
| Artifact Registry (images, kept 1 day) | a few hundred MB | 0.5 GB | **$0** |
| her router (Cloudflare free): tickets, meter, side-by-side | ≤ ~15,000 requests and writes a day | 100,000 a day | **$0** |
| the budget itself | — | free | **$0** |

**How late Google's figures can be:** its budget messages arrive several times a day, and cost data can lag by several
hours (Google says only "a delay"; guides say several hours; up to about a day is possible). That is why guard 1 does
not wait for Google: it counts itself, at once, and stops at HALF the free allowance — so even a full day's delay
cannot reach a cost. The most it could cost in the delay, with guards 1 and 2: **$0** — provided nothing else on the
billing account uses the same free allowance (step 4) and meeraSearch's own Google account may shut its door (step 5).

## Before the first deploy — Ravi
1. "live karo" for the router update (tickets, side-by-side, meter, alarm) — her router must have them first.
2. The two keys: `C:\AMAZON\meera-deploy\keys.env` (made on this computer, never in the repository or chat). Put them in
   GitHub → Settings → Secrets → Actions as **MEERA_METER_KEY** and **MEERA_STOP_KEY** (the router's deploy sends them to
   Cloudflare), or type them into Cloudflare → meera-router → Settings → Variables and Secrets as METER_KEY / STOP_KEY.
3. The budget: console.cloud.google.com → Billing → Budgets & alerts → Create budget → name "Meera — never a cent", scope
   project price-research-48ff3, amount ₹1 (or the smallest it takes), thresholds as you like → **Manage notifications →
   "Connect a Pub/Sub topic to this budget" → topic `meera-budget`** in project price-research-48ff3 (create it there if
   asked) → Finish. Also tick email alerts to billing admins.
4. **The shared allowance:** Billing → Reports, last 3 months, filtered to Cloud Run, Cloud Run functions / Cloud
   Functions, Cloud Build and Artifact Registry, for the whole billing account — anything else using them? (Or let me
   look, in the app's browser with your sign-in.) If yes, the meter's limits go down by that much.
5. After the deploy, one check (no cost): that meeraSearch's own Google account may change its door — Cloud Run →
   meerasearch → Permissions: its service account needs "Cloud Run Developer" (or Editor). If not, guard 1 still stops
   her search in every browser, but the door stays open — tell me, and we add that one role.

## Deploy (after "live karo")
```
node meera/functions/build.cjs
copy C:\AMAZON\meera-deploy\keys.env meera\functions\.env
mklink /J meera\functions\node_modules C:\AMAZON\meera-deploy\node_modules
cd meera\firebase
C:\Users\User\tools\firebase\firebase.exe deploy --only functions:meera --project price-research-48ff3
C:\Users\User\tools\firebase\firebase.exe functions:artifacts:setpolicy --location asia-south1 --days 1 --project price-research-48ff3
cd ..\.. & rmdir meera\functions\node_modules & del meera\functions\.env
```
Check (no data): `curl -H "Origin: https://fabricrush-replenish.web.app" https://asia-south1-price-research-48ff3.cloudfunctions.net/meeraSearch/wake` → 401
(it wants a sign-in: it is up).

## See the meter
Meera's learning (admin page) → Switches: "This month's meter: N of 1,000,000 requests · S of 90,000 computer-seconds".

## Turn her search off by hand (at once, for everyone, no deploy)
Meera's learning → Switches → "Search on the server" → Turn off. (Or keep the ERP switches `server` / `serveruse` off —
they are off.)

## Undo the whole thing
```
C:\Users\User\tools\firebase\firebase.exe functions:delete meeraSearch meeraCostAlarm --region asia-south1 --project price-research-48ff3
```
then delete the budget (Billing → Budgets & alerts) and the topic `meera-budget` (Pub/Sub → Topics). Every browser searches
on its own, as before.

## The library for the local read
157 packages (firebase-functions 6.4.0 + firebase-admin 13.10.0 and what they need), every file checked against jsDelivr
and unpkg — `meera/firebase/sdk-list.json`; fetched by `meera/firebase/fetch-sdk.mjs` into `C:\AMAZON\meera-deploy` (done
3 Nov: 2,895 files matched; one `.cmd` benchmark script jsDelivr will not serve, left out). Never in the repository.
