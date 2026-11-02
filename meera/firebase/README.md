# Meera's search on Firebase Cloud Functions — deploy by hand (master plan D.2)

Only on Ravi's "live karo", from the office computer, with the Firebase tool (`C:\Users\User\tools\firebase\firebase.exe`,
signed in as ravi@ — `firebase.exe login --no-localhost --reauth` if it asks). Never from GitHub.

## What goes up
One function, **meeraSearch**, in its own group ("codebase" `meera`), so nothing else in the project is touched:
region asia-south1 (Mumbai), **max 2 instances, none kept warm**, 1 GiB / 1 CPU, 15 s limit. It holds her answers,
walk-throughs and meaning table (copied in by `meera/functions/build.cjs`) and keeps nothing — no database, no file.
Its address: https://asia-south1-price-research-48ff3.cloudfunctions.net/meeraSearch (`/wake`, `/search`).
Nobody uses it until the switch `server` (side by side) or `serveruse` is on.

## Cost (Google's prices, read 2 Nov 2026 — meera/docs/decisions/server-search-firebase.md)
- Questions: ~18,000 a month (40 staff × 15 a day — to be confirmed) ≈ 3,000 CPU-seconds with the cold starts, against
  180,000 free → **$0**. Requests 18,000 against 2 million free → **$0**.
- Building it (Cloud Build): a few minutes against 2,500 free → **$0**. Its image (Artifact Registry): a few hundred MB
  against 0.5 GB free → **$0** if old images are cleaned (answer "yes" to the clean-up question, keep 1 day).
- The free allowances are per billing account: anything else on it shares them (not checked — Ravi's billing page).
- The most it could ever use: 2 instances busy without a stop ≈ $4.4 a day — only if something kept asking all day;
  each signed-in person is capped at 400 questions a day per instance. The $1 budget alert below warns long before.

## Before the first deploy — one gap
The Firebase tool reads the function on this computer before sending it, and for that it needs Google's library
`firebase-functions` in `meera/functions/node_modules`. This computer cannot reach the package registry (npm is blocked);
the jsDelivr mirror can be reached. Choose one (Ravi):
1. Allow a one-time download of `firebase-functions@6.4.0` and its few helpers from jsDelivr into
   `meera/functions/node_modules` (only for that local read; Google installs its own copy when it builds) — or
2. deploy once from a computer or network where `npm install` works.

## Deploy (after "live karo")
```
node meera/functions/build.cjs
cd meera/firebase
C:\Users\User\tools\firebase\firebase.exe deploy --only functions:meera --project price-research-48ff3
```
The first time, Google switches on Cloud Functions, Cloud Build, Artifact Registry and Cloud Run for the project (free to
switch on). Then check (no sign-in, no data):
```
curl -H "Origin: https://fabricrush-replenish.web.app" https://asia-south1-price-research-48ff3.cloudfunctions.net/meeraSearch/wake
```
→ `{"ok":true,"n":3287,…}`.

## Undo
- At once, for everyone, no deploy: Meera's learning → Switches → "Search on the server" off (her router's switch; every
  browser searches on its own again). Or keep the ERP switches `server` / `serveruse` off (they are off).
- Remove the function: `firebase.exe functions:delete meeraSearch --region asia-south1 --project price-research-48ff3`
  (or Firebase console → Functions → meeraSearch → Delete).

## A $1 budget alert (Ravi sets it)
Google Cloud console (console.cloud.google.com, the Google account that owns billing) → **Billing** → pick the billing
account of project price-research-48ff3 → **Budgets & alerts** → **Create budget**:
1. Name: "Meera — 1 dollar". Scope: Projects → price-research-48ff3; Services → all (or Cloud Run Functions, Cloud Run,
   Cloud Build, Artifact Registry).
2. Amount: Budget type "Specified amount", **1** (in the account's currency: about ₹85 if it is in rupees).
3. Actions: alert thresholds 50 %, 90 %, 100 % of **actual** spend (add 100 % of forecasted too); "Email alerts to billing
   admins and users" ticked.
4. Finish. A budget only WARNS by email; it does not stop anything — the max of 2 instances is the hard limit.
