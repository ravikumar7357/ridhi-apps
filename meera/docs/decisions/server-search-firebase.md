# Server search on Firebase Cloud Functions — cost and cold start (master plan D.1, 2 Nov 2026)

**Not built.** This is the check before building, for Ravi's OK.

## What would run
Her own search (the same code the browser runs, `meera/router/src/search.gen.js`) as one Cloud Function (2nd generation,
which Google runs on Cloud Run), region **asia-south1 (Mumbai)**, behind the small search layer so it can move to
Supabase later. It holds her answers and meaning table in memory; no Firestore or Realtime Database is used, so the quota
fix is untouched. Answers an admin approves come from her Cloudflare router (`/learned`), read again every few minutes.

## Measured on the office computer (her real 3,287 answers, 380 test questions, 3 runs)
| | |
|---|---|
| start-up: load her answers + meaning table, build the search | 0.67–0.73 s (0.74–0.86 s of computer time) |
| first question after start-up | ~30 ms |
| each question after that | average 21 ms of computer time; middle 16 ms; 95 in 100 under 32 ms; slowest ~0.3 s |
| memory | ~280 MB → needs a 1 GiB instance (with 1 vCPU, so start-up stays ~0.8 s) |

Google's own start of a Node function (before her start-up) is not measured: that needs a deploy. Typical figures are
around 1 second, so a **cold** first question would take roughly **2 seconds**; every question while it is warm ~0.1 s
plus the trip to Mumbai.

## Google's prices (cloud.google.com/run/pricing, read 2 Nov 2026; asia-south1 is a Tier 1 region)
Request-based billing (charged only while a question is being answered, rounded up to 100 ms):
CPU $0.000024 per vCPU-second · memory $0.0000025 per GiB-second · $0.40 per million requests.
A kept-warm (minimum) instance, when idle: $0.0000025 per vCPU-second + $0.0000025 per GiB-second.
Free every month (per billing account): 180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests (≈ $6 of use).

## Monthly cost
Assumed (Ravi to give the real numbers): 40 staff × 15 questions a day = **18,000 questions a month**.

| | use a month | cost a month |
|---|---|---|
| questions (each billed 0.1 s, 1 vCPU + 1 GiB) | 1,800 vCPU-s, 1,800 GiB-s, 18,000 requests | inside the free allowance → **$0** (≈ $0.06 without it) |
| cold starts (say 20 a day × ~2 s) | 1,200 vCPU-s, 1,200 GiB-s | **$0** (≈ $0.03 without it) |
| 10 × as many questions (180,000) | ~21,000 vCPU-s | **$0** (≈ $0.6 without it) |
| keeping ONE instance warm all month (no cold start ever) | 2.6 million idle seconds | **≈ $13** (≈ $7 after the free allowance, if nothing else uses it) |
| container storage (Artifact Registry) and deploy builds | < 1 GB, a few build minutes | a few cents |
| replies to browsers (~2.6 KB each) | ~50 MB | well under $0.01 |

The free allowance is shared with anything else on the same billing account; the project's other Google use was not
checked (that would mean reading the live billing page — ask first).

## Recommendation
- **No warm instance** (min instances 0): about **$0 a month**.
- Hide the cold start instead: when a person opens Ask Meera, the browser sends a tiny "wake up" call, so the function
  starts while they type (free). If the function is slow or down, she answers from her own copy, as now.
- Keep the browser's own search as the fallback and switch only after side-by-side (`server`) shows it as good or better.

## Before building — Ravi
1. OK to build (behind the switches `server` / `serveruse`, off for everyone).
2. Deploying a function is a change to the Firebase project: it needs "live karo". GitHub's current deploy key is
   "Firebase Hosting Admin" only; deploying functions from GitHub needs that key to get Cloud Functions rights — a
   permission change, Ravi's to make. (Or it is deployed from the office computer with the Firebase tool.)
3. Optional, to measure Google's own cold start for real: one throwaway test function (pennies, deleted afterwards) —
   also on "live karo".
