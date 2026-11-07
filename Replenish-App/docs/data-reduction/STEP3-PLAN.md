# Step 3 — Each page loads only its own registers (detailed plan)

7 Nov 2026 · for Ravi · part of [PLAN.md](PLAN.md) (follows its 8 rules). **Plan only — nothing built.**

## 1. Goal
Pages that need only the master (Master DB, vendors, RFD, Greige, HR, Replenishment) stop downloading the order book and
factory registers: about **2.2 MB instead of about 11 MB** the first time they open in a tab. Every number on every screen stays the same.

Size: BIG, but shipped in small parts — Part A (one builder), then Parts B–D one page group at a time (one builder per group, no shared files).

## 2. What the code taught us

| Finding | Where | What it means |
|---|---|---|
| The Order Console's line builder combines order book, Job Work, cutting, press, QC checks, Shopify production and master | `orders/production-to-shipping.js:173-190`, `core/lookups.js:67-123`, `core/look-alike-skus.js:64-101`, `production/job-work-entry.js:44-74` | These 7 can't load apart: order book without Job Work = wrong pending figures, no error |
| ~30 files call those helpers with "if it's there, use it" guards | e.g. `inventory/store.js:564`, `vendors/orders/accept-delivery.js:76,86`, `masters/masters.js:182`, `core/meera-bridge.js:75,214` | Rule after Step 3: order book loaded ⇒ everything loaded |
| "Master database loaded" (`PTG.mdb`) used as "everything loaded" | ~40 places | Already unreliable: Master DB Refresh sets it alone (`vendors/printing/fabric-catalogue.js:532-537`) |
| Job Work and cutting have their own loader (`ptLoad`) | `core/database-read.js:107` etc. | Unchanged |
| Live copies make a second read in a tab free | `core/live-copies.js` | Saving is on registers a tab never opens: first page in a new tab, reload, after a deploy |
| `Pricing-App/rules/read-map.json` can't be used | built from an old copy; PPC, Greige Desk, Dashboard, Meeting missing; lists all 9 for every loader page | We build our own list; no Sellora file touched |

**So two sets, not nine lists:**
- **Master set:** masters + master database (~2.2 MB).
- **All set:** all 9 registers (today, ~11 MB).

Register sizes are estimates (order book ~4.5 MB, master + masters ~2.2 MB, other six ~4.3 MB). The data meter decides the real figures.

## 3. Screens → set

M masters, D master database, O order book, P press, Z cutting freezes, C cutting, B Job Work, S Shopify production, Q QC.
"Lines" = Order Console line builder (O, B, C, P, Q, S, D). **?** = unsure; the static test decides before that group ships.

| Caller (src/app/…) | Screen | Reads | Set |
|---|---|---|---|
| core/nav.js:483-485 ptOpenFresh | Job Work, Cutting, Press | own loader; refresh if loaded | All (unchanged) |
| core/nav.js:487, orders/order-console.js:33 | Order Console | Lines, S (writes S) | All |
| shopify/bulk-entry.js:1317 | Order Console refresh | Lines, writes S | All (force) |
| core/nav.js:510, flow/flow-view.js:26, 851 | PPC | everything | All |
| production/press.js:13, 201, 262 | Press | P, O, D | All |
| production/job-work-entry.js:565 | Job Work form | B, P, Q, O, D, M | All |
| core/look-alike-skus.js:363 | Cutting form | O, C, D, Z | All |
| production/quality-control.js:23 | QC | Lines, B, C, Q | All |
| orders/sales-orders.js:32 | Sales Orders | O, C, B, P | All |
| orders/delete-requests.js:280 | SO delete requests | O, Lines | All |
| orders/custom-order-skus.js:118, 343, 408 | Custom SKUs / Change SKU | **writes O, B, C, P, Q** | All (force before rename) |
| masters/master-database-edit.js:300 | Master DB edit / rename | D, M, O, P, C | All for rename; Master for edit **?** |
| orders/reserve.js:174 | Reserve | D, sales/vendor orders | Master **?** |
| orders/reserve.js:529, 567 | Place vendor order (save) | stamps from O | All (save waits) |
| vendors/orders/place-vendor-order.js:187 | Vendor order form | D, M; same-colour uses Lines | All **?** |
| vendors/orders/accept-delivery.js:625 | Vendor log / accept | D; Lines on accept | All on accept; Master for list **?** |
| vendors/orders/vendor-order-requests.js:91 | Vendor requests | D | Master |
| vendors/rfd/rfd-stock-auto.js:29 | RFD dialog | D | Master |
| vendors/rfd/order-driven-rfd.js:572 | RFD | D | Master **?** |
| vendors/printing/printer-capacity.js:194 | Printer capacity | D; allocation uses Lines | All **?** |
| vendors/portal/vendor-portal.js:1512 | Vendor sync (admin) | M | Master |
| vendors/portal/vendor-master.js:43 | Vendor master | M | Master |
| vendors/greige/fabric-flow.js:26, 31 | Fabric flow | D, M, own B | Master + own B |
| flow/greige-desk.js:4173 | Greige Desk | M | Master |
| masters/master-database.js:6, sku-codes.js:258, core/lookups.js:269 | Master DB | D, M | Master |
| masters/masters.js:81, 579 | Masters | M, D; print-key view uses Lines | All **?** |
| inventory/accessories.js:38, 659 | Accessories | M | Master |
| inventory/store.js:68 | Store | D, M, own B/C; order rows use Lines | All **?** |
| inventory/finished-goods.js, fg-receive-excel.js | Finished Goods | D, P, Lines | All |
| replenishment/in-production.js:21 | In production | D | Master |
| replenishment/shopify-stock.js:23, 220 | Shopify stock | D, M | Master |
| orders/customer-orders.js:41 | Customer orders | D | Master **?** |
| people-pay/finance-hr.js:103 | HR / pay | D + own B | Master + own B |
| reports/*, dashboard/management-dashboard.js, reports/meeting.js | Reports, Karigar analysis, Meeting, Dispatch, Dashboard | everything | All |
| shopify/returns.js, production-bucket.js, orders-to-make.js, bucket-excel.js | Returns, Bucket, To make | O, Lines, B, D | All |
| core/mobile.js:784 | Phone search | D; order search uses Lines | Master; orders only when All loaded |
| orders/order-ticker.js | Order strip | Lines | No load (tickerPlain); shows only when All loaded |
| core/meera-bridge.js:46-214 | Meera | M, D, B, Lines | No load; order answers only when All loaded |

## 4. How it works (Part A: core/gates.js + switch)

- **Switch `pageRegisters`** — copy of pbOn/pbSaveFlag: localStorage '0'/'1', else `prFlagLast` from `config/flags.pageRegisters`
  (same auth.js read). Off when AUDIT.on is false; off for vendors (first version).
- **core/gates.js:** `PTG_REGS` (9 names), `PTG_MASTER = ['masters','mdb']`, `PTG_ALL`, `PTG_AT` (load time per register,
  written only by the loader), `PTG_FLY` (one read in flight per register).
- **`ptNeed(set, {force, light, why})`** — switch off: `ptLoadGates(force, light)`, today's path untouched. Switch on: loads
  only missing/stale registers of the set in parallel (10 min; 30 min for M/D on a light refresh), stored exactly as today
  (mdbYnFix, replMasterSync, PT.cut/PT.base stamps, QC own catch). A failed register stays unloaded, others still land.
- **`ptHas(set)`** — off: `!!PTG.ob`; on: every register in the set has a time.
- `ptGatesStale(set)`, `ptOpenFresh(tab, ensure, set)` per set (no set = All). `ptLoadGates` with switch on = `ptNeed(PTG_ALL)`,
  so any unconverted caller still gets everything.
- `PTG.at` = oldest time once all nine loaded. `ptImgShared()` once, with the first load that includes D.
  `deltaShadowSoon()` only once All is loaded.
- **Part A converts every presence check** (`!PTG.mdb`, `!PTG.ob`, `!PTG.press`, `!PTG.masters`) to `ptNeed(PTG_ALL, '<tab>')`
  or `ptHas(PTG_ALL)`. Every list is still All after Part A, so the switch changes nothing yet; Parts B–D narrow groups.

## 5. Two safety nets

**Part B item:** ptNeedRun clears PTG.err at the start of every call; with the switch on, keep errors per register so a parallel ask can't wipe another's error (in-production.js:501 checks PTG.err).

**Part A status (7 Nov):** the runtime guard below is NOT built in Part A (deferred to Part B, which narrows the first screens); the full call-graph screen check in the static test is also Part B. Part A built the gates, the switch, the converted presence checks, the synchronous refusals in cutGuard / bdGuard / the QC check save, and the test with its teeth.

**Runtime guard (switch on):** the nine PTG fields become getters/setters. Reading an unloaded register logs one line per
page + register (data meter `undeclared` tally), loads it in the background and redraws the screen. Honest limit: a screen
already drawn may show a short list for ~1 second before the redraw — the static test is what keeps lists right.
**Saves never use a missing register:** every save that reads registers awaits `ptNeed(PTG_ALL)` first (reserve.js 529/567,
Change SKU, Job Work issue, cutting, QC, press, Order Console status buttons, accept delivery). Synchronous guards
(`cutGuard`, `obIssueUsed`, `qcOrderAvail`) refuse with "Still reading the order book, try again in a moment".

**Static test `tests/page-registers-test.js`** (in `npm run check`): maps every function to the registers it reaches
(following calls), checks each screen's entry against its declared set, fails on any presence check left outside gates.js
or any write to PTG_AT outside the loader; a vm run of gates.js proves switch-off = today's nine reads and values, and
switch-on behaviour. **Teeth:** remove 'ob' from an All screen; switch-off path skips a read; a Master screen reaching PT.base.

## 6. Rollout (each group: tests → preview → Ravi's PC 2–3 days → everybody)

| Order | Group | Screens moved to Master | Saving per first open |
|---|---|---|---|
| A | Core + all checks converted | none | 0 (meter must show no change) |
| B | Master DB, vendor masters | Master DB, SKU codes, vendor master, vendor sync, Accessories | ~8.8 MB |
| C | Vendors, RFD | vendor requests, RFD, RFD stock, Reserve ?, vendor log list ? | ~8.8 MB |
| D | Greige, store side, HR, Replenishment | Greige Desk, fabric flow, HR/pay, In production, Shopify stock, customer orders ? | ~8.8 MB |
| — | Order Console, PPC, Job Work, Cutting, Press, QC, FG, Sales Orders, Reports, Dashboard, Meeting, Bucket, Returns | stay All | 0 (Step 4 is their saving) |

Gate per group: static test green; on preview each moved screen matches live (counts, totals, Excel); meter shows ~2.2 MB
on those pages; no "undeclared" lines for 2 working days on Ravi's PC. **Only pays if `tickerPlain` is on too.**
Correct PLAN.md Step 3 estimate to "11 → ~2.2 MB on master-only pages, unchanged on order and factory pages".

## 7. Risks
- The "everything loaded" check — all converted at once in Part A; test rule; switch off until clean.
- Partial order data — the 7 order registers only load together; `ptHas(PTG_ALL)` guards strip, Meera, phone search, helpers.
- Saves — Change SKU and vendor-order stamping await All (forced fresh for rename); teeth test each.
- Meera — order/karigar answers say "open the Order Console" without All; SKU card works on Master.
- Phones — phone search never triggers All; biggest gain (mobile data).
- Not edited: core/delta-sync.js, core/live-copies.js, the 10/30-minute comments in gates.js, banners, Pricing-App. CRLF kept.
- Live: flag on for everybody and the deploy are RAVI ONLY.

## 8. Done when
- [ ] Part A: checks converted, page-registers-test (3 teeth) in check, all suites green, switch-off identical to today
- [ ] Preview: Master DB, vendors, RFD, Greige, HR pages match live; meter ~2.2 MB on them
- [ ] Order Console, PPC, Job Work, QC, Reports unchanged on preview
- [ ] Ravi's PC 2–3 days: no "undeclared" lines, no wrong figures
- [ ] Everybody (Ravi's word); switch kept ≥ 2 weeks; PLAN.md estimate corrected

## 9. Questions for Ravi — answered 7 Nov 2026: "Yes, take recommended" (all four as recommended)
1. Factory screens get no saving from this step — go ahead for office pages anyway? (Recommended: yes; factory saving is Step 4.)
2. A screen needing more data the first time may wait ~1 s or show "updating…" — OK? (Recommended: yes; entry screens always wait.)
3. On master-only pages, Meera and phone search say "open the Order Console" for order questions — OK? (Recommended: yes.)
4. Leave vendor-portal phones out of the first version? (Recommended: yes.)
