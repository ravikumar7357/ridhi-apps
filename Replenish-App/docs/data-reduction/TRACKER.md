# Data reduction — tracker

One line per step of [PLAN.md](PLAN.md). Update the status and date when a step moves. Target: 1.5 GB/day (proposed; Ravi to confirm).

Status: Not started · Building · Preview · Ravi's PC · Everybody · Dropped

| Step | Status | Switch name | Gate | Date |
| --- | --- | --- | --- | --- |
| 0 — Safety and baseline | Meter **Everybody** since 10 Nov (`config/flags` created that day; before it nothing could switch on). First numbers 10 Nov: 1.64 GB from 10 people, 93% first loads after a reload or new tab. Billing alert, ₹3,000 budget alert, checks B/C still open (Ravi) | `dataMeter` | Billing shows no warning, alerts set, meter has 3 working days of data | 2026-11-12 |
| 1 — Ticker and badges: pending items only | **Badges: Everybody** (`pendingBadges` true, 12 Nov; 45 tests pass; Ravi's PC since 10 Nov; switch kept 2+ weeks). Ticker: Stage 0 still line **dropped** (Ravi: the ticker must look as before; `tickerPlain` stays off). Alert list ([ALERT-LIST-PLAN.md](ALERT-LIST-PLAN.md)) Stages 1+2 live, rules published 12 Nov; **Stage 1 shadow running** since 12 Nov (`alertListBuild` true: rebuild 3,435 lines, first check same=true 0/0/0); Stage 2 off until 5 clean days (~19 Nov) | `pendingBadges` (badges); `alertListBuild`, `alertList` (ticker) | Badges: done. Alert list: shadow log clean 5 working days → Ravi's PC → everybody | 2026-11-12 |
| 2 — Archive closed orders older than 90 days | **Dropped** (Ravi, 12 Nov). Measured 12 Nov: Order Book 7,473 lines / 4.7 MB, only 18 lines older than 90 days (0.01 MB). A 30-day archive of closed Shopify lines would be 1.45 MB (31%) but the Completed tab shows them and Delta Sync makes reloads cheap — revisit only after Delta is on. Cheaper later tidy: remarks 0.57 MB (one remark on 1,671 lines), Shopify picture links 0.48 MB | – | – | 2026-11-12 |
| 3 — Each page loads only its registers | Parts A–D live, switched off ([STEP3-PLAN.md](STEP3-PLAN.md)): Master DB, SKU codes, Accessories, vendor master/sync, vendor requests, RFD, vendor log, Greige Desk, HR/pay, Shopify stock, customer orders open on the master (~2.2 MB vs ~11 MB). Turn on after the alert list's Stage 2 | `pageRegisters` | Static test and runtime guard pass; preview → Ravi's PC → everybody | 2026-11-12 |
| 4 — Fix change notes, then Delta Sync phase 3 | Built and live, switched off ([STEP4-5-PLAN.md](STEP4-5-PLAN.md)): 4a note rule published 12 Nov; 4b save + note together; 4d checker diagnostics; 4e daily full download; 4f shared-PC wipe + "Shared computer" tick (active); 4g switch. `syncAtomic` trial waits for a real save | `syncAtomic`, `deltaUse` | syncAtomic: one PC then everybody. deltaUse: checker 0 mismatches 4 working days → Ravi's PC 3 days → everybody | 2026-11-12 |
| 5 — Tabs share one copy of the data | Not started | `sharedTabs` | Only if the meter's tab count justifies it; falls back to one copy per tab | 2026-11-05 |
| 6 — Split the code file per page (optional) | Not started | not named in plan | Only if billing shows Hosting is a real cost and the 1.5 GB/day target is not met | 2026-11-05 |

Date = last status change (2026-11-05 is the day the plan was agreed). Step 4's parts 4a–4h are one line here; split them if they move separately.
