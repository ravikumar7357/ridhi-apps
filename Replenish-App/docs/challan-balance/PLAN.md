# Cloth left by challan — plan (14 Nov 2026)

Asked by Ravi after the team handover "Printed Fabric Flow" (14 Nov), proposal (b): for every challan,
how much came, how much was used, how much is left, and how many days it has been lying.
Proposal (a), the printed cloth store that adds and takes off by itself, is already built
(inventory/store.js `stFlowMoves`, since 16 Oct), so it is not part of this plan.

## Ravi's answers (14 Nov)
- Both kinds of line: running cloth in metres, and lines printed as SKU pieces, in pieces.
- Used more than came: Left shows 0, with a red note "used 12 m more than came".
- Lying too long: red after **7 days** since the last receipt on that challan.
- Who sees it: anyone with the Printed fabric in right (`flchl`). No new right.

## Where it shows
Production flow → Demand → Printed fabric in → a fifth button next to "By challan":
**Cloth left by challan**. Same search box, same TEST-only switch, a Download Excel button.

## One row per challan line
| Column | Where it comes from |
|---|---|
| Challan · printer · order · SKU | the challan (`pt_flowChallans`) |
| Printed fabric + colour | `flowChLineWhat` |
| Sent | `flowChSent` (metres or pieces, `flowChUnit`) |
| Received · last received on | the challan's receipts (`flowChRecv`) |
| Used | **metres**: cutting entries of the same order line (`stCutting` metres, typed or worked out) **less** the waste strips the cutter puts back in the store · **pieces**: issued to karigar for that order line (`flowState` → `issuedNet`) |

Changed while building (14 Nov): waste is cloth that goes **back** to the store (the cutting entry says "waste … back in the
store"), so it is taken off what was used, not added to it. What a PPC plan took from the printed store is **not** counted: that
cloth came from older stock, not from this challan. Used more than came shows as one red label in place of "All used".
| Left | Received − Used, never below 0; if below, 0 and the red "used … more than came" note |
| Days lying | days since the last receipt, only while Left > 0; red from 7 days |
| Where it is | "Waiting to cut / issue" while the order line is still in To cut or Raw cutting in store; **"Leftover"** once the line has moved on — that is the real leftover cloth |

Totals per printer and per printed fabric + colour at the foot.

## Rules
- One order line on two or more challans: what was used comes off the **oldest receipt first**.
- A line moved to another printer is left out — it already shows under "Standing with printers".
- A "no RFD challan" record (cloth received over 10%) shows like any challan, so extra cloth is visible.
- A cutting entry cut from rejected or wastage cloth (`clothFrom`) uses nothing here, as in the store.
- Cancelled challans left out. Orders before 15 Oct are not in the flow and do not show (said in the screen's note).
- The total of Left will **not** equal Store Stock Balance: the store also holds opening stock and hand entries.

## How it is built
- New file `src/app/flow/flow-balance.js` (listed in `src/app/ORDER` after flow-receive.js), functions prefixed `flowBal*`:
  `flowBalRows` (the figures), `flowBalTable` (the screen), `flowBalXl` (Excel, `recipeXlsx`).
- Hooks: the button list, the bar and the table switch in `flow/flow-view.js`. The suite is in `npm run check`; `tests/teeth/teeth-balance.js` breaks 7 rules on purpose and the suite catches all 7.
- Reuses `flowChRecv`, `flowChSent`, `flowChUnit`, `flowChMoved`, `flowChLineWhat`, `flowMixTxt`, `stCutting`, `flowKey`, `flowRows`, `flowRemDays`.
- **Saves nothing.** No new data, no Firebase rules, no switch. Reads only what the screen already loads.
- Error handling: it is a view. A line it cannot work out is shown with "—" and a console note; the screen never throws.

## Tests
- New `tests/flow-balance-test.js`: 100 m in, 60 m cut + 5 m waste → 35 m left · two challans for one line → oldest first ·
  used more than came → 0 + note · moved line left out · `clothFrom` cut ignored · pieces line: 50 in, 30 issued → 20 left ·
  7-day red · Leftover vs Waiting to cut.
- A broken copy (e.g. Left without waste) must make the suite fail.
- `npm run check`, then a browser check in the local preview with a TEST order.

## Not in this plan
- Cutter picking which challan the cloth came from (more exact, but one more step on every cutting entry).
- Anything on the live site: built and tested locally; going to `main` only on Ravi's word.

## Checked on live data (14 Nov, look-only test ERP, saving off)
510 challan lines with cloth received on 272 challans; 148 shown with cloth left (or used over).
- Metres: 33 lines, 13 with cutting entries — every one matched its challan line by order number + SKU. None used more than came.
- **Fixed:** 2 lines were cut with no metres typed and none to work out (CPC-SC-007: 807 pcs; RTCRRU165-120: 1 pc). They showed
  as 0 m used and "Leftover". Now: grey "Cut … pcs — metres not typed", kept out of Leftover / Waiting, counted in the top bar.
- **Fixed:** 16 pieces lines issued more than came on the challan (e.g. CPC007-04: 446 issued, 121 on challans — the rest came
  back through Vendor Orders). Now said as "Issued … more than came", not "Used".
- Live figures: Leftover 3.08 m · Waiting 906.09 m · 794 pcs · 33 challans lying over 7 days · 2 lines metres not typed.

## What to do — buttons and filter (14 Nov, Ravi: "make it actionable")
Each line is one job for one desk; its button opens the screen the job is done on today (same form, same checks). Nothing here saves.
| What to do | Who | Button |
|---|---|---|
| Cut | Cutting | **Cutting entry →** — Cutting Data, filled for the line (as To cut opens it) |
| Issue | Job Work | **Issue to karigar →** — Job Work Register, filled for the line |
| Fix metres | Cutting | **Fix metres →** — that cutting entry's Edit (needs "Can edit production entries"; without it the message shows here) |
| Check receipt | Receiving | **Receive on challan →** — the printer's Receive dialog, searched to the SKU; if the printer owes nothing: "came another way — check Vendor Orders" |
| Leftover | Store | no button — "Check it is on the shelf" (Store Stock Balance already holds it) |
Chips "What to do: All · Cut · Issue · Fix metres · Check receipt · Leftover" with counts, and "Over 7 days only". Excel adds What to do + Who.
Live (14 Nov): Cut 20 · Issue 102 · Fix metres 2 · Check receipt 16 (all still owed → Receive) · Leftover 8. Every button tried on live data, look-only.
Open question for Ravi: Leftover "Checked in store" / "Write off as waste" would save (store ledger) — not built.

## Drop-downs and one wide table (14 Nov, Ravi: "drop down ke tareeke se aur multiple columns ke saath")
- Printed fabric in: its 5 view buttons are one drop-down (`data-flangsel`, as RFD fabric has); "Due dates · remind — 363 late" in its option.
- Cloth left by challan: What to do · Days · Printer drop-downs with counts, Excel, one line of totals. Chips and tick boxes gone.
  "Every line (used up too)" in What to do replaces "Only with cloth left".
- One table, 13 columns: Challan · Printer · Order · SKU · Printed fabric · Sent · Received · Used · Left · Last received · Days · What to do · Who · open.
- Worked out once per screen (was twice per draw): kept until the challans, cutting entries, flow lines or search change.
- tests/flow-test.js: 4 checks moved from the old buttons to the drop-down options.
- **Not done — Meera:** 10 of Meera's walk-throughs press `[data-flang="due"]` / `[data-flang="challan"]` (receive, close short, undo
  receipt, challan edit/cancel/reopen …). With the drop-down those steps find no button. Before this goes live, either Meera's
  walks are changed to the drop-down (her own release) or the view buttons stay. Ravi to decide after seeing it locally.
