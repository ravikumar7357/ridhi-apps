# Order alert list — plan (Step 1, ticker part)

Planned 6 Nov 2026 from Ravi's "4th option" brief. **Plan only — nothing built.** Follows the 8 rules in [PLAN.md](PLAN.md).

**Goal:** office pages show the order ticker from a small list of open order lines (well under 1 MB) instead of
downloading about 11 MB of registers. The ticker shows exactly the same items as today.

## 1. Where the list lives

- `pt_orderAlerts` = `{ v, at, lease, l: { <order no>__<SKU>: entry } }`
  - `v` = rule version (a new version rebuilds the whole list); `at` = server time of the last full check, shown as
    "checked at HH:MM"; `lease` = which page is doing the background check.
- `pt_orderAlertsLog/<day>` = check results and differences (falls under the existing catch-all rule: staff write, admins read).
- No existing node fits: Order Book, Sales Orders and Shopify production are read whole by their screens, and `pt_sync`
  is read by Delta Sync.
- **One small rule** is needed, in `Pricing-App/rules/read-model.js` (`BY_HAND`): `pt_orderAlerts: { tabs: ['ord','shopprod','so'] }`
  → read for admins + the three tabs that see the ticker today, write for staff. Not needed until Stage 2 "everybody":
  Ravi is an admin, so Stages 1 and "Ravi only" work without a rules deploy.
- Limit: a factory user without the Order Console, Shopify production or Sales Orders tab writes the list but can't read
  it, so their page never runs the background check.

## 2. One shared save helper — yes

Every database write goes through `ptPut`, `ptCas`, `ptPatch`, `ptDelete` in `src/app/core/history.js` (no other writer;
`ptAuditWrite` writes logs only). All four already run "after a successful save" steps (`auditLog`, `ptSyncNote`); the
list hook goes beside them. This covers order status, create/complete/cancel/delete, pressed and QC pieces, stock used,
Shopify hand-over and sales order delivery date.

Catch: the hook always sees the save, but can only work out the new entry on a page that holds the registers and the
master (and uses that page's copy, up to ~10 minutes old — same as today's ticker on that page). Sales order date changes
are applied at once (due date alone). Other office-page saves are fixed by the background check.

## 3. Apps Scripts that write orders — none

Repl-API, Repl-API-CPC, Pricing-API, Backup-Script (read-only export), FBA-Pricing, FBA-Sheet: none writes orders, press,
QC or Shopify production. Not covered: Meera router, `fba-forecast`, hand-run probe scripts, Firebase-console hand edits —
the background check fixes those.

## 4. Each entry carries everything the ticker needs

`no`, `sku`, `ch`, `what` (name · colour), `qty` (pieces, pack size worked in), `pr` (pressed/QC'd, quilt counters worked
in), `fs` (from stock), `due` + `dh` (sales order or 5 working days), `st` (stage), `tab` + `id` (screen + record),
`at`. ~200–230 bytes. Pillow-insert lines left out, as today. **Office pages never need the master.**

## 5. Download estimate (assumptions until the data meter measures)

- Office page: ~1 KB + open lines × ~220 B → 400 lines ≈ 90 KB; worst case ~1,300 ≈ 290 KB. **97–99% less than ~11 MB.**
- Then changes only: ~220 B per changed line per open tab. Rough day: 1,500 changes × 220 B × 40 tabs ≈ 13 MB + page loads.
- Factory pages add the same ~90–290 KB (they read the list to check it).

## 6. Ravi's 12 design rules

| # | Rule | Met? |
|---|---|---|
| 1 | Never harms saving | ✅ after save, never waited for. **Deliberate exception to PLAN rule 5** (same-update writes) — fine for a throw-away list |
| 2 | One low-level hook | ✅ for catching saves; working out the entry needs the registers |
| 3 | Write only when needed | ✅ where the page can read the list |
| 4 | One shared rule | ✅ `oalEntry(line, soDue)` used by today's ticker and the list |
| 5 | Disposable list | ✅ "Rebuild list" + version number |
| 6 | Quiet repair | ✅ 15-minute lease via compare-and-set; fingerprint; write only differing rows; own log (meter is off) |
| 7 | Two nets | ✅ code test + live mismatch log |
| 8 | No new rule | ❌ one small rule needed (section 1) |
| 9 | Retry | ✅ own small retry list (Firebase's offline queue doesn't apply: the app writes over plain web requests) |
| 10 | Instant fix | 🟡 instant for the saving page and sales order dates; other changes within 15 min while a factory page with access is open |
| 11 | Apps Script too | ✅ nothing to do |
| 12 | Server watcher | see section 7 |

## 7. Server watcher (Cloud Function) — not to be built

Prices from memory — check firebase.google.com/pricing.
- Would close the gap to seconds for any writer. Needs the paid **Blaze** plan (is the project on it now? Ravi to confirm).
- Assumed 1,500–3,000 saves/day → 45k–90k runs/month, inside the free 2 million → ~$0 running cost.
- Real cost is reads: ~1.5–5 GB/month ≈ $1.5–5 (≈ ₹150–450).
- No hard spending cap in Firebase — only alerts: budget alert ₹500/month, max 2 instances, kill switch, never trigger on its own list.
- Needs `npm` + a functions deploy (`npm` is blocked on this PC). **Advice: not worth it while the background check works.**

## 8. Remaining risks

- Stage 0 makes the first Order Console open slower on office pages (registers no longer pre-loaded); features that relied
  on the pre-load (e.g. Meera's order answers) load on demand. Tester must check.
- An entry can be up to 15 minutes wrong when no factory page with access is open (nights, Sundays); "checked at" shows it.
- Today's ticker uses sales order dates only if that tab already loaded Sales Orders; the list always uses them, so more
  Amazon/B2B lines can appear as critical.
- Keep the `/* ==== … ==== */` banners in history.js, live-copies.js, production-to-shipping.js, order-ticker.js unchanged.
- `build-rules.js` holds uncommitted Step 0 + Step 1 badge rules: a rules deploy sends everything in that file.
- Sellora's rules checker (`screens-check.js` / `read-audit.js`) may flag the new read until `read-map.json` is regenerated.

## 9. Build plan

**Stage 0 — plain line on office pages (small)**
1. `core/auth.js`: read `config/flags.tickerPlain` in the same login read; `localStorage tickerPlain` overrides.
2. `orders/order-ticker.js`: switch on → never calls `ptLoadGates`; page without registers shows "Pending and critical
   orders: open the Order Console" (click opens the Order Console). Factory pages and switch-off unchanged.
3. Tests: `tests/order-ticker-test.js` + teeth; preview check that office pages download no registers.
4. RAVI ONLY: push → `tickerPlain=1` on Ravi's PC 2–3 days → `config/flags.tickerPlain=true`.

**Stage 1 — shadow week (built, nobody sees it)**
1. New `orders/order-alerts.js`: `oalEntry`, `oalKey`, `oalAfterSave`, worker (~3 s after a save, only changed lines,
   one update), retry list, lease + 15-minute check, `oalRebuild`, shadow comparison, log. Switch `alertListBuild`, OFF.
2. `core/history.js`: one guarded line after `ptSyncNote` in each helper. `order-ticker.js`: `otkItems` split into
   `oalEntry` + `otkItemsFrom(entries, today)` — same output.
3. Tests: same items as today on fixtures; every helper triggers the hook; failed save doesn't; static scan fails on any
   database write outside the four helpers; retry survives offline; one of two pages wins the lease; switch off = no
   writes; teeth (pieces owed off by one; hook removed from `ptPatch`). Plus the existing suites.
4. RAVI ONLY: deploy with switch off → `alertListBuild=1` on Ravi's PC 3 days → on for everybody's saves → gate: zero
   mismatches for 5 working days.

**Stage 2 — Ravi, then everybody**
1. `order-ticker.js`: switch `alertList`, OFF. On → reads `pt_orderAlerts` via the live copy, shows "checked at HH:MM";
   missing/unreadable → plain line; off → today's ticker on reload.
2. RAVI ONLY: `alertList=1` on Ravi's PC 2–3 days.
3. RAVI ONLY, in order: rules line → `node build-rules.js` → deploy via `rules-tool.js` → app deploy if changed →
   `config/flags.alertList=true` → measure with the data meter.
4. Optional later: open the screen where the order sits (`tab` + `id` already in each entry; one small change per target screen).

**Done when:** Stage 0 office pages download no registers · all tests and teeth pass, incl. switch-off · shadow log clean
5 working days · list ticker = today's ticker on fixtures · rules deployed before switching on for everybody · data meter
confirms the saving.

## Decisions (Ravi, 6 Nov 2026)

1. **Sales order dates: always use them**, as the brief says. More Amazon/B2B lines may show as critical than today.
2. **Old list: show it with "checked at …"** (up to ~18 h, e.g. Sundays), not the plain line after 2 h. A deliberate
   departure from PLAN.md's 2-hour rule for this list; "checked at" makes the age visible.
3. **Instant fix: instant for the saving page and sales order dates; other changes within 15 minutes** while a factory
   page with list access is open.
4. **Rules deploy: together with the Step 0 meter rule and the Step 1 badge indexes** — Ravi brought the Step 0 rules back
   so the meter can save (the "alone" option assumed he didn't want that).
   Still open: is the project on the Blaze plan? (Firebase console → ⚙ → Usage and billing.) Only matters for the server watcher, which is not planned.
