# Step 4h — more registers under Delta Sync (plan only, nothing built)

12 Nov 2026 · base main c7fdbc8 = live · part of [STEP4-5-PLAN.md](STEP4-5-PLAN.md), follows [PLAN.md](PLAN.md)'s 8 rules.

## Goal
Reopening a page stops downloading Finished Goods, Sales Orders, PPC, Print orders, Custom SKUs, Accessories and Vendor
Orders in full; only changed rows come down. Every number stays the same. About 611 MB/day of these 7 on the 10 Nov meter
(10 people); expected saving roughly 0.35–0.45 GB/day (60–75%), 6–12 MB less per full reopen. The meter decides.

## What the code says
All writes go through ptPatch / ptPut / ptDelete; no Apps Script writes these; ptCas only claims new print-order numbers.

| Register (MB/day) | Who writes | Shape | Note key |
|---|---|---|---|
| pt_fgiLedger (135) | ~15 FG / FBA / packing / Shopify screens; Excel receive in chunks of 400 (>300 rows → full read); "clear all" = reset | flat `<id>` | row id |
| pt_salesOrders (89) | Raise SO, qty changes, delete requests, Orders to make, custom-SKU merge | flat `<orderNo>` | row |
| pt_ppc (83) | PPC, challan, edit, test-order clean-up | flat `<line>` | row |
| pt_flowPrintOrders (55) | PPC / edit patches; new numbers via ptCas (already notes after save) | flat `<no>` | row |
| pt_customSkus (43) | Bucket, returns, Job Work, Raise SO, reserve, lookups | flat `<sku>` | row |
| pt_accLedger (29) | Accessories, custom-SKU merge, probe acc-restore | flat `<id>` | row |
| pt_vendorOrders (177) | staff (~10 screens) **and printers on their own branch** (portal, daily challan, RFD) | nested `<code>/<orderId>` | `<code>\|<orderId>`; a whole `<code>` write = reset |

Probes/patches that write these (zip-backfill, acc-restore, flow-fg-backfill, rfd-stock-tag, cleanup-*) must go through
`_noted-write.js`. The Meera router is not on this PC; sync-sample decides whether it writes anything.

## Switches (switch off = byte-for-byte today)
- `syncMore` — list of registers whose change notes are written (config/flags + localStorage). The 8 existing registers unchanged.
- `deltaMore` — list of registers read from the browser copy (needs `deltaUse` on and the register in `syncMore`).

## Builders
- **A** (core/history.js, core/auth.js): `PT_SYNC_MORE` set; `smList()`; ptSyncPaths adds a listed register only;
  Vendor Orders depth-2 key `code|id` (skip if either part contains `|`); optional printer same-request note only with
  syncMore + syncAtomic and Ravi's word (vendor portal is do-not-touch); flag lines for syncMore / deltaMore incl. .catch.
- **B** (core/delta-sync.js phase-2/3 blocks, core/data-meter.js label): `DELTA_REG` with vendor-orders flatten/unflatten;
  shallow key check per printer code; shadow loops the listed registers only where the page already has a live copy,
  at most once per device per day; deltaLiveOpen accepts a new register only when deltaUse + deltaMore + syncMore.
- **C** (Pricing-App/rules/build-rules.js, tests/probes, probe-writes-test): `SYNC_MORE` pt_sync entries like the 8;
  Vendor Orders `$key` note writable by a printer only for its own code (`beginsWith(code + '|')`), with the stamp rule.

## Ravi's steps, in order
1. Read-only shallow scan of Vendor Orders keys (no `|` in codes or ids).
2. Rules deploy (console or rules-tool), commit live rules + undo file. Changes nothing on its own.
3. Push the app (switches off) → `syncMore=pt_fgiLedger pt_salesOrders` on Ravi's PC 1 day (pt_syncAudit noteRefused = 0)
   → config/flags.syncMore. Count clean days from 24 h later.
4. sync-sample until 0 mismatches 4 working days → `deltaMore` (same list) on Ravi's PC 3 days → config/flags.deltaMore.
5. Repeat per group; meter 2 weeks.

**Order:** FG + Sales Orders → PPC + Print orders → Custom SKUs + Accessories → Vendor Orders (last, alone).

## Tests
npm run check + sync, delta, delta-live, probe-writes and the three teeth suites. New: switch-off golden test; only
listed registers get notes; vendor `code|id` keys, decoding, whole-branch reset; shadow skips registers without a live
copy and runs once a day; flatten round-trip. Teeth: break the list gate; break the key separator.

## Risks
Note rule not live → atomic save refused (rules first; 403 retries the old way) · vendor portal do-not-touch · big
shallow reads (hence once a day) · old-build tabs write no notes (hence 24 h wait) · bulk imports > 300 rows always full
read · probes skipping `_noted-write`.

## Questions for Ravi (recommended answers)
1. When to start notes for the new registers? — After syncAtomic is on for everybody and the 8 registers have 1 clean
   week; `deltaMore` waits until the 8 are clean 4 weeks under deltaUse.
2. May a printer write the change note for its own Vendor Orders? — Yes to the rule (tested with one test printer login);
   same-request saves for printers only with Ravi's word.
3. One register at a time or in groups? — Groups of two; Vendor Orders alone and last.
