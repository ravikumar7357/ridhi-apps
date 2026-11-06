# Data reduction — tracker

One line per step of [PLAN.md](PLAN.md). Update the status and date when a step moves. Target: 1.5 GB/day (proposed; Ravi to confirm).

Status: Not started · Building · Preview · Ravi's PC · Everybody · Dropped

| Step | Status | Switch name | Gate | Date |
| --- | --- | --- | --- | --- |
| 0 — Safety and baseline | Building | `dataMeter` | Billing shows no warning, alerts set, meter has 3 working days of data | 2026-11-05 |
| 1 — Ticker and badges: pending items only | Not started | `pendingQueries` | Query count equals full-data count on fixtures; teeth test fails when the filter is broken; switch-off path tested; then preview → Ravi's PC 2–3 days → everybody | 2026-11-05 |
| 2 — Archive closed orders older than 90 days | Not started | not named in plan | 30-day dry run logs no closed order a screen still opens; test fails if a screen reads `pt_orderBook` directly; then one month at a time | 2026-11-05 |
| 3 — Each page loads only its registers | Not started | `pageRegisters` | Static test and runtime guard pass; one page group at a time through preview | 2026-11-05 |
| 4 — Fix change notes, then Delta Sync phase 3 | Not started | `DELTA.use` (device: `deltaUse`) | Shadow shows 0 mismatches for 4 consecutive working days → Ravi's PC 3 days → everybody | 2026-11-05 |
| 5 — Tabs share one copy of the data | Not started | `sharedTabs` | Only if the meter's tab count justifies it; falls back to one copy per tab | 2026-11-05 |
| 6 — Split the code file per page (optional) | Not started | not named in plan | Only if billing shows Hosting is a real cost and the 1.5 GB/day target is not met | 2026-11-05 |

Date = last status change (2026-11-05 is the day the plan was agreed). Step 4's parts 4a–4h are one line here; split them if they move separately.
