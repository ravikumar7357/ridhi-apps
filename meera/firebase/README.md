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

## The download for the local read (approved by Ravi 2 Nov, with conditions)
Exactly these 157 packages, pinned (firebase-functions 6.4.0 + firebase-admin 13.10.0 and what they need; firebase-admin's optional
database and storage clients left out). Checked 2 Nov: all 2,896 files have the same SHA-256 at jsDelivr and unpkg (34.7 MB).
`node meera/firebase/fetch-sdk.mjs C:\AMAZON\meera-deploy\node_modules` fetches them, checking every file, into a folder of their own
(outside the repository and the ERP); for the deploy, meera/functions/node_modules is a link to it, removed afterwards.

@fastify/busboy@3.2.4 · @firebase/app-check-interop-types@0.3.5 · @firebase/app-types@0.9.6 · @firebase/auth-interop-types@0.2.6 · @firebase/component@0.7.5 · @firebase/database-compat@2.1.7 · @firebase/database-types@1.0.22 · @firebase/database@1.1.5 · @firebase/logger@0.5.2 · @firebase/util@1.15.3 · @protobufjs/aspromise@1.1.2 · @protobufjs/base64@1.1.2 · @protobufjs/codegen@2.0.5 · @protobufjs/eventemitter@1.1.1 · @protobufjs/fetch@1.1.1 · @protobufjs/float@1.0.2 · @protobufjs/path@1.1.2 · @protobufjs/pool@1.1.0 · @protobufjs/utf8@1.1.2 · @types/body-parser@1.19.6 · @types/connect@3.4.38 · @types/cors@2.8.19 · @types/express-serve-static-core@4.19.9 · @types/express@4.17.25 · @types/http-errors@2.0.5 · @types/jsonwebtoken@9.0.10 · @types/mime@1.3.5 · @types/ms@2.1.0 · @types/node@26.6.6 · @types/qs@6.15.1 · @types/range-parser@1.2.7 · @types/send@0.17.6 (inside @types/serve-static) · @types/send@1.2.1 · @types/serve-static@1.15.10 · accepts@1.3.8 · agent-base@7.1.4 · array-flatten@1.1.1 · async-function@1.0.0 · async-generator-function@1.0.0 · base64-js@1.5.1 · bignumber.js@9.3.1 · body-parser@1.20.9 · buffer-equal-constant-time@1.0.1 · bytes@3.1.2 · call-bind-apply-helpers@1.0.2 · call-bound@1.0.4 · content-disposition@0.5.4 · content-type@1.0.5 · cookie-signature@1.0.7 · cookie@0.7.2 · cors@2.8.6 · data-uri-to-buffer@4.0.1 · debug@2.6.9 · debug@4.4.3 (inside https-proxy-agent) · depd@2.0.0 · destroy@1.2.0 · dunder-proto@1.0.1 · ecdsa-sig-formatter@1.0.11 · ee-first@1.1.1 · encodeurl@2.0.1 · es-define-property@1.0.1 · es-errors@1.3.0 · es-object-atoms@1.1.2 · escape-html@1.0.3 · etag@1.8.1 · express@4.22.3 · extend@3.0.2 · farmhash-modern@1.1.0 · fast-deep-equal@3.1.3 · faye-websocket@0.11.4 · fetch-blob@3.2.0 · finalhandler@1.3.2 · firebase-admin@13.10.0 · firebase-functions@6.4.0 · formdata-polyfill@4.0.10 · forwarded@0.2.0 · fresh@0.5.2 · function-bind@1.1.2 · gaxios@7.3.1 · gcp-metadata@8.1.2 · generator-function@2.0.1 · get-intrinsic@1.3.1 · get-proto@1.0.1 · google-auth-library@10.9.1 · google-logging-utils@1.1.3 (inside google-auth-library) · google-logging-utils@1.2.0 · gopd@1.2.0 · has-symbols@1.1.0 · hasown@2.0.4 · http-errors@2.0.1 · http-parser-js@0.5.10 · https-proxy-agent@7.0.6 · iconv-lite@0.4.24 · inherits@2.0.4 · ipaddr.js@1.9.1 · jose@4.15.9 · json-bigint@1.0.0 · jsonwebtoken@9.0.3 · jwa@2.0.1 · jwks-rsa@3.2.2 · jws@4.0.1 · limiter@1.1.5 · lodash.clonedeep@4.5.0 · lodash.includes@4.3.0 · lodash.isboolean@3.0.3 · lodash.isinteger@4.0.4 · lodash.isnumber@3.0.3 · lodash.isplainobject@4.0.6 · lodash.isstring@4.0.1 · lodash.once@4.1.1 · long@5.3.2 · lru-cache@6.0.0 · lru-memoizer@2.3.0 · math-intrinsics@1.1.0 · media-typer@0.3.0 · merge-descriptors@1.0.3 · methods@1.1.2 · mime-db@1.52.0 · mime-types@2.1.35 · mime@1.6.0 · ms@2.0.0 · ms@2.1.3 (inside send) · negotiator@0.6.3 · node-domexception@1.0.0 · node-fetch@3.3.2 · object-assign@4.1.1 · object-inspect@1.13.4 · on-finished@2.4.2 · parseurl@1.3.3 · path-to-regexp@0.1.13 · protobufjs@7.6.6 · proxy-addr@2.0.8 · qs@6.16.2 · range-parser@1.2.1 · raw-body@2.5.3 · safe-buffer@5.2.1 · safer-buffer@2.1.2 · semver@7.8.5 · send@0.19.2 · serve-static@1.16.3 · setprototypeof@1.2.0 · side-channel-list@1.0.1 · side-channel-map@1.0.1 · side-channel-weakmap@1.0.2 · side-channel@1.1.1 · statuses@2.0.2 · toidentifier@1.0.1 · tslib@2.9.1 · type-is@1.6.18 · undici-types@8.9.0 · unpipe@1.0.0 · utils-merge@1.0.1 · vary@1.1.2 · web-streams-polyfill@3.3.3 · websocket-driver@0.7.5 · websocket-extensions@0.1.4 · yallist@4.0.0
