# Steps 4 and 5 — fix the change notes, Delta Sync phase 3, tabs share one copy (detailed plan)

10 Nov 2026 · for Ravi · part of [PLAN.md](PLAN.md), follows its 8 rules. **Plan only — nothing built.** Base: main = live 202480d.

## 1. Goal
Factory pages (Order Console, PPC, Job Work, Cutting, Press, QC, Reports) stop downloading the 8 big registers again on
every reload, new tab or deploy: they fetch only the rows that changed. Office pages get the same for the master.
Every number on every screen stays the same.

## 2. What the code taught us

| Finding | Where | Meaning |
|---|---|---|
| Only the 4 save helpers write; the change note goes out AFTER the save as a second request nobody waits for | `core/history.js` 194–291, `ptSyncNote` 96 | A tab closing between the two leaves a changed row with no note → 4b |
| `ptCas` only used for pt_flowRev / pt_flowChallans / pt_flowPrintOrders and the alert-list lease | flow-core.js, order-alerts.js | Never a synced register; keeps its after-save note |
| Vendors cannot write the 8 registers (STAFF excludes them); pt_masterDB / pt_masters use any(ADMIN, right) | build-rules.js | Vendors do NOT explain the Order Book / Cutting mismatches (PLAN.md line 88 is wrong) |
| No Apps Script writes the registers (Repl-API* write Firestore; Backup reads; fba-forecast has no DB code; Meera router not on this PC) | Repl-API Code.js | Outside writers: 25 hand-run scripts in tests/probes + tests/patches, and Firebase console edits |
| The shadow saves its copy whenever the connection says "up" — just after a reconnect the live copy can be old | delta-sync.js 163–168 | Could save a stale copy → repeated mismatches (to prove) |
| Only the first 20 differing rows are re-checked | delta-sync.js 139–144 | Counts can look higher than real |
| Phase 3 code exists but is off; DELTA.use is a constant, not in config/flags | delta-sync.js 20–22, 197–291 | Needs the switch wired (rule 1) |
| A delta open moves the copy's time forward | delta-sync.js 239 | A daily PC never takes the "older than a day → full" path → 4e |
| Job Work (pt_baseData) is not a Delta register | history.js 78 | Factory pages still download Job Work in full (~1 MB) |
| Delta reads metered as "delta-shadow"; the pt_sync listener not metered | delta-sync.js 84 | Fix labels so the meter proves the saving |

## 3. Step 4 parts

| Part | What | Files | Switch | Build now? | Risk |
|---|---|---|---|---|---|
| **4a** Note rule | pt_sync/<reg>/$key and _reset: value must be server time; pt_masterDB/pt_masters notes writable by "STAFF or whoever may write that register" | Pricing-App/rules/build-rules.js | (rule) | Yes; **deploy RAVI ONLY**, together with the waiting pt_orderAlerts rule | A wrong check would refuse atomic saves — rule goes live before 4b's switch; 4b retries the old way on 403 |
| **4b** Atomic notes | Data + note in ONE request in ptPatch/ptPut/ptDelete for synced paths; not for vendors / AUDIT off / ptCas; on 403 retry the old way and log; the alert-list hook and history get the original updates only | core/history.js, core/auth.js, tests | `syncAtomic` | Yes | Preview saves write live data → RAVI ONLY; banners untouched |
| **4c** Cloud Function note | Server writes the note for any writer | — | — | **Do not build.** ≈ ₹0–100/month, no hard cap, needs npm. Only if 4d finds an outside writer that can't be routed | |
| **4d** Explain the mismatches | Shadow logs a short field diff for up to 3 rows per register + `upFor`; saves a copy only after 60 s connected; reports `unchecked`; read-only `tests/probes/sync-sample.js` sorts samples into causes; all probe/patch scripts must use `tests/probes/_noted-write.js`; `sync-reset.js` after console edits | core/delta-sync.js (phase-2 block), tests, probes | (shadow) | Yes; **running sync-sample / sync-reset is RAVI ONLY** | pt_syncAudit grows ≤ 600 chars per register per run |
| **4e** Full-download time | `fullAt` set only by a full download; > 24 h or missing → full | core/delta-sync.js | under deltaUse | Yes | One full download per device per day (by design) |
| **4f** Shared PCs and phones | At sign-in, another account's delta copy is deleted; "Shared computer" tick at sign-in; sign-out on a shared PC deletes it; storage full/cleared → full download | delta-sync.js, auth.js, index.html | — | Yes — **matters today**: the shadow already keeps copies on staff PCs | Vendor PIN box untouched |
| **4g** Gate + switch | `deltaUse` in the single config/flags read; after go-live 1 in 10 sessions run the full path + shadow; meter labels delta / delta-notes / delta-shadow | delta-sync.js, auth.js | `deltaUse` | Yes | Redraw right after a save may fall back to a full read (watch the meter) |
| **4h** Later registers | Finished Goods, Vendor Orders, Sales Orders — each rules first, then its own shadow | history.js, build-rules.js | deltaUse | No — after 4 clean weeks | |

**What sync-sample decides (4d):** note after copy time + type/shape difference → normalise in deltaCanon · no note + a
pt_audit line → note lost → 4b · no note + no audit line → writer outside the app → name it, route via _noted-write.js
or sync-reset · upFor < 60 s → stale copy → 4d guard.

## 4. Step 5 — tabs share one copy (design; build only if the meter justifies it)
Switch `sharedTabs` (off on phones, vendors, harnesses). New `core/shared-tabs.js` (stb*): a leader tab per account+build
(navigator.locks) holds the listeners and passes data to other tabs over BroadcastChannel (whole register once, then
changed rows with a sequence number; a gap → full resend). Each tab still writes itself. No answer from the leader in
3 s → the tab reads on its own as today. Needs ONE guarded line in `ptLiveRead` (live-copy cache — do-not-touch list →
Ravi's word). Shadow first (followers keep their own listener and compare; log pt_tabsAudit), gate 0 mismatches for 4
working days on Ravi's PC, then followers drop their own listeners.

## 5. Order of work
1. Now, in parallel: builder-A 4b (+ 4f auth/index, flag lines); builder-B 4d, 4e, 4f wipe, 4g, probes; builder-C 4a. All switches off.
2. **RAVI ONLY:** rules deploy from this PC (`node rules-tool.js deploy`: 4a + pt_orderAlerts), commit the live rules + undo file.
3. **RAVI ONLY:** push the app (switches off); `syncAtomic=1` on Ravi's PC 2–3 days; then config/flags.syncAtomic=true.
4. **RAVI ONLY:** after 2 working days of the new shadow log, run sync-sample.js (read only); fix each cause; repeat to 0.
5. Gate 3: 0 mismatches 4 working days → deltaUse on Ravi's PC 3 days → config/flags.deltaUse=true; 1-in-10 shadow keeps running.
6. Meter 2 weeks → decide Step 5 and 4h.

## 6. Estimated saving (assumptions; the meter decides)
Per factory reopen: ~11 MB → ~1.3 MB (8 registers ~10 MB → changed rows + notes 0.2–0.5 MB, plus Job Work ~1 MB).
One full download per device per day.

| Factory device opens/day | Today | After Step 4 | Less |
|---|---|---|---|
| 3 | 33 MB | ~14 MB | ~58% |
| 5 | 55 MB | ~16 MB | ~70% |
| 8 | 88 MB | ~20 MB | ~77% |

Office pages: master 2.2 MB → ~0.1 MB on a reopen. Step 5 then saves ~1.3 MB per extra tab.

## 7. Risks
Atomic save refused (rule first + retry the old way + vendors on the old path) · redraw right after a save in Delta mode
may fall back to a full read (watch the meter; a 2 s wait needs one live-copies line and Ravi's word) · do-not-touch:
banners in history.js / delta-sync.js / live-copies.js, the live-copy cache, database.rules.json only via rules-tool ·
Pricing-App: build-rules.js only, under the data-reduction exception · any preview save writes live data · keep CRLF.

## 8. Questions for Ravi — answered 10 Nov 2026: "Yes, take recommended" (all four as recommended)
1. Shared computers: "Shared computer" tick at sign-in, and always delete another person's copy at sign-in? — **Yes to both.**
2. One full download per device per day as the safety net? — **Yes** (~11 MB per device per day).
3. One rules deploy: 4a together with the waiting alert-list rule, from this PC via rules-tool? — **Yes.**
4. Step 5: build only if the meter shows people use 2+ tabs after Step 4, allowing the one live-copy line then? — **Yes, wait for the meter.**
(4c Cloud Function, ≈ ₹0–100/month: not built.)
